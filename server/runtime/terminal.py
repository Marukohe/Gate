#!/usr/bin/env python3
"""Linux PTY worker. Runtime stdin/stdout carry JSON; the child owns the terminal."""
import base64
import errno
import fcntl
import json
import os
import pty
import select
import signal
import struct
import sys
import termios
import time


def emit(value):
    print(json.dumps(value), flush=True)


stopping = False


def stop(_signal, _frame):
    global stopping
    stopping = True


def session_pids(leader):
    # The direct child is not reaped until cleanup, pinning this session ID against PID reuse.
    result = []
    for name in os.listdir('/proc'):
        if not name.isdigit():
            continue
        try:
            with open('/proc/' + name + '/stat') as source:
                fields = source.read().rsplit(')', 1)[1].split()
            if int(fields[3]) == leader and fields[0] != 'Z':
                result.append(int(name))
        except (FileNotFoundError, ProcessLookupError, PermissionError):
            pass
    return result


def belongs_to_session(member, leader):
    try:
        with open('/proc/' + str(member) + '/stat') as source:
            return int(source.read().rsplit(')', 1)[1].split()[3]) == leader
    except (FileNotFoundError, ProcessLookupError):
        return False


def resize(fd, cols, rows):
    if not isinstance(cols, int) or not isinstance(rows, int) or not 2 <= cols <= 500 or not 2 <= rows <= 200:
        raise ValueError('Invalid terminal dimensions')
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', rows, cols, 0, 0))
    emit({'type': 'terminal-resize', 'cols': cols, 'rows': rows})


def main():
    global stopping
    pid = None
    master = None
    code = 1
    exit_signal = None
    try:
        if not sys.platform.startswith('linux'):
            raise RuntimeError('Managed terminals currently require Linux')
        config = json.loads(sys.stdin.buffer.raw.readline(65536))
        signal.signal(signal.SIGTERM, stop)
        signal.signal(signal.SIGINT, stop)
        pid, master = pty.fork()
        if pid == 0:
            signal.signal(signal.SIGTERM, signal.SIG_DFL)
            signal.signal(signal.SIGINT, signal.SIG_DFL)
            try:
                os.chdir(config['cwd'])
                env = dict(os.environ, TERM='xterm-256color', COLORTERM='truecolor', GATE_MANAGED='1')
                env['PATH'] = config['nodeDirectory'] + ':' + env.get('PATH', '')
                os.execve(config['executable'], [config['executable']] + config['args'], env)
            except Exception as error:
                os.write(2, (str(error) + '\r\n').encode())
                os._exit(127)
        resize(master, config.get('cols', 80), config.get('rows', 24))
        os.set_blocking(0, False)
        os.set_blocking(master, False)
        pending = b''
        to_write = b''
        eof = False
        while not stopping:
            exited = os.waitid(os.P_PID, pid, os.WEXITED | os.WNOHANG | os.WNOWAIT)
            if exited:
                break
            readable, writable, _ = select.select([0] + ([] if eof else [master]), [master] if to_write else [], [], 0.05)
            if 0 in readable:
                data = os.read(0, 65536)
                if not data:
                    stopping = True
                pending += data
                if len(pending) > 131072:
                    raise ValueError('Terminal input frame too large')
                while b'\n' in pending:
                    line, pending = pending.split(b'\n', 1)
                    message = json.loads(line)
                    if message['type'] == 'input':
                        to_write += base64.b64decode(message['data'], validate=True)
                        if len(to_write) > 262144:
                            raise ValueError('Terminal input backlog exceeded')
                    elif message['type'] == 'resize':
                        resize(master, message['cols'], message['rows'])
                    else:
                        raise ValueError('Unknown terminal message')
            if master in writable:
                try:
                    to_write = to_write[os.write(master, to_write):]
                except BlockingIOError:
                    pass
            if master in readable:
                try:
                    data = os.read(master, 16384)
                    if data:
                        emit({'type': 'terminal-output', 'data': base64.b64encode(data).decode()})
                    else:
                        eof = True
                except OSError as error:
                    if error.errno != errno.EIO:
                        raise
                    eof = True
    except Exception as error:
        emit({'type': 'result', 'failed': True, 'message': str(error)})
    finally:
        if pid:
            # Interactive shells put foreground and background jobs in different process groups.
            # Kill all remaining members of this owned session before reaping its leader.
            for sig, duration in [(signal.SIGTERM, 0.3), (signal.SIGKILL, 0.3)]:
                deadline = time.monotonic() + duration
                while True:
                    members = session_pids(pid)
                    if not members:
                        break
                    for member in members:
                        try:
                            descriptor = os.pidfd_open(member)
                            try:
                                if belongs_to_session(member, pid):
                                    signal.pidfd_send_signal(descriptor, sig)
                            finally:
                                os.close(descriptor)
                        except ProcessLookupError:
                            pass
                    if time.monotonic() >= deadline:
                        break
                    time.sleep(0.01)
            if session_pids(pid):
                raise RuntimeError('Terminal descendants did not exit; ownership is unconfirmed')
            _, status = os.waitpid(pid, 0)
            if os.WIFEXITED(status):
                code = os.WEXITSTATUS(status)
            elif os.WIFSIGNALED(status):
                exit_signal = signal.Signals(os.WTERMSIG(status)).name
                code = 128 + os.WTERMSIG(status)
            # Drain final output, including applications that exit immediately after printing.
            while True:
                try:
                    data = os.read(master, 16384)
                    if not data:
                        break
                    emit({'type': 'terminal-output', 'data': base64.b64encode(data).decode()})
                except (BlockingIOError, OSError):
                    break
            os.close(master)
        emit({'type': 'terminal-exit', 'exitCode': code, 'signal': exit_signal})
    return code


if __name__ == '__main__':
    sys.exit(main())
