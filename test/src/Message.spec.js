/*
 * Copyright (c) 2015 TechnologyAdvice
 */

import Message from 'src/Message';

function getSQSMsg(body) {
  return {
    MessageId: 'msgId',
    ReceiptHandle: 'handle',
    MD5OfBody: 'abcdeabcdeabcdeabcdeabcdeabcde12',
    Body: body
  };
}

describe('Message', () => {
  it('unwraps an SNS message', () => {
    const msg = new Message({
      msg: getSQSMsg('{"Message":"foo","bar":"baz"}'),
      unwrapSns: true,
      msgFormat: 'plain'
    });
    msg.should.have.property('body').equal('foo');
  });
  it('parses JSON', () => {
    const msg = new Message({
      msg: getSQSMsg('{"Message":"foo","bar":"baz"}'),
      msgFormat: 'json'
    });
    msg.should.have.property('body');
    msg.body.should.be.an.Object;
    msg.body.should.have.property('Message').equal('foo');
    msg.body.should.have.property('bar').equal('baz');
  });
  it('calls Squiss.deleteMessage on delete', (done) => {
    const msg = new Message({
      msg: getSQSMsg('{"Message":"foo","bar":"baz"}'),
      msgFormat: 'json',
      squiss: {
        deleteMessage: (toDel) => {
          toDel.should.equal(msg);
          done();
        }
      }
    });
    msg.del();
  });
  it('calls Squiss.handledMessage on keep', (done) => {
    const msg = new Message({
      msg: getSQSMsg('{"Message":"foo","bar":"baz"}'),
      msgFormat: 'json',
      squiss: {
        handledMessage: () => done()
      }
    });
    msg.keep();
  });
  it('treats del() and keep() as idempotent', () => {
    let calls = 0;
    const msg = new Message({
      msg: getSQSMsg('{"Message":"foo","bar":"baz"}'),
      msgFormat: 'json',
      squiss: {
        deleteMessage: () => calls += 1,
        handledMessage: () => calls += 10
      }
    });
    msg.del();
    msg.keep();
    msg.del();
    calls.should.equal(1);
  });
});
