#!/usr/bin/env node
import readline from 'node:readline';
import fs from 'node:fs';
const send = (value) => console.log(JSON.stringify(value));
let timer;
let readOnly = false;
const reviewFinish = new URL('./finish-review', import.meta.url);
const decisions = new Map();
const input = readline.createInterface({ input: process.stdin });
input.on('line', (line) => {
  const msg = JSON.parse(line);
  if (msg.type === 'control_request' && msg.request?.subtype === 'initialize') {
    send({ type: 'control_response', response: { subtype: 'success', request_id: msg.request_id, response: {} } });
  }
  if (msg.type === 'user') {
    fs.writeFileSync('received-prompt', msg.message.content);
    send({ type: 'system', session_id: 'fixture-claude' });
    send({ type: 'assistant', message: { content: [{ type: 'text', text: 'Prior agent finding: verify the timeout edge.' }] } });
    send({ type: 'result', is_error: false });
  }
  if ([100, 101].includes(msg.id) && msg.result) {
    if (decisions.has(msg.id)) throw new Error('Duplicate decision delivered');
    decisions.set(msg.id, msg.result);
    fs.appendFileSync('decision-replies', JSON.stringify(msg) + '\n');
    send({ method: 'serverRequest/resolved', params: { requestId: msg.id } });
    if (msg.result.decision === 'cancel') send({ method: 'turn/completed', params: { turn: { status: 'interrupted' } } });
    if (decisions.size === 2) send({ method: 'turn/completed', params: { turn: { status: 'completed' } } });
  }
  if (msg.method === 'initialize') send({ id: msg.id, result: {} });
  if (msg.method === 'config/read') send({ id: msg.id, result: { config: {} } });
  if (msg.method === 'thread/start') {
    readOnly = msg.params.sandbox === 'read-only';
    send({ id: msg.id, result: { thread: { id: 'fixture-thread' } } });
  }
  if (msg.method === 'turn/start') {
    if (!readOnly) fs.writeFileSync('received-prompt', msg.params.input[0].text);
    if (readOnly) {
      if (msg.params.input[0].text.includes('mutate-fixture')) fs.writeFileSync('unexpected-review-edit', 'changed');
      timer = setInterval(() => {
        if (fs.existsSync(reviewFinish)) {
          clearInterval(timer);
          send({ method: 'item/completed', params: { item: { type: 'agentMessage', text: 'Independent fixture finding: inspect the timeout.' } } });
          send({ method: 'turn/completed', params: { turn: { status: 'completed' } } });
        }
      }, 100);
      return;
    }
    send({ id: msg.id, result: { turn: { id: 'fixture-turn' } } });
    if (msg.params.input[0].text === 'cancel-fixture') {
      send({ id: 100, method: 'item/commandExecution/requestApproval', params: {
        command: 'printf probe', cwd: process.cwd(), availableDecisions: ['accept', 'cancel'],
      } });
      return;
    }
    if (msg.params.input[0].text === 'approval-fixture') {
      send({ id: 100, method: 'item/commandExecution/requestApproval', params: {
        command: 'npm test', cwd: process.cwd(), reason: 'Validate changes', availableDecisions: ['accept', 'decline'],
      } });
      send({ id: 101, method: 'item/tool/requestUserInput', params: {
        questions: [{ id: 'target', question: 'Which target?', options: [{ label: 'Linux', description: 'Local tests' }] }],
      } });
      return;
    }
    let tick = 0;
    timer = setInterval(() => {
      send({ method: 'item/completed', params: { item: { type: 'agentMessage', text: 'tick ' + ++tick } } });
      if (fs.existsSync('finish-fixture')) {
        clearInterval(timer);
        send({ method: 'turn/completed', params: { turn: { status: 'completed' } } });
      }
    }, 100);
  }
});
input.on('close', () => { clearInterval(timer); process.exit(0); });
