/*
 * Copyright (c) 2015-2016 TechnologyAdvice
 */

'use strict'

const Message = require('src/Message')

function getSQSMsg(body) {
  return {
    MessageId: 'msgId',
    ReceiptHandle: 'handle',
    MD5OfBody: 'abcdeabcdeabcdeabcdeabcdeabcde12',
    Body: body
  }
}

const snsMsg = {
  Type: 'Notification',
  MessageId: 'some-id',
  TopicArn: 'arn:aws:sns:us-east-1:1234567890:sns-topic-name',
  Subject: 'some-subject',
  Message: 'foo',
  Timestamp: '2015-11-25T04:17:37.741Z',
  SignatureVersion: '1',
  Signature: 'dGVzdAo=',
  SigningCertURL: 'https://sns.us-east-1.amazonaws.com/SimpleNotificationService-bb750dd426d95ee9390147a5624348ee.pem',
  UnsubscribeURL: 'https://sns.us-east-1.amazonaws.com/?Action=Unsubscribe&SubscriptionArn=arn:aws:sns:us-east-1:1234567890:sns-topic-name:12345678-1234-4321-1234-123456789012'
}

describe('Message', () => {
  it('unwraps an SNS message', () => {
    const msg = new Message({
      msg: getSQSMsg(JSON.stringify(snsMsg)),
      unwrapSns: true,
      bodyFormat: 'plain'
    })
    msg.should.have.property('body').equal('foo')
    msg.should.have.property('subject').equal('some-subject')
    msg.should.have.property('topicArn').equal(snsMsg.TopicArn)
    msg.should.have.property('topicName').equal('sns-topic-name')
  })
  it('parses JSON', () => {
    const msg = new Message({
      msg: getSQSMsg('{"Message":"foo","bar":"baz"}'),
      bodyFormat: 'json'
    })
    msg.should.have.property('body')
    msg.body.should.be.an('object')
    msg.body.should.have.property('Message').equal('foo')
    msg.body.should.have.property('bar').equal('baz')
  })
  it('calls Squiss.deleteMessage on delete', (done) => {
    const msg = new Message({
      msg: getSQSMsg('{"Message":"foo","bar":"baz"}'),
      bodyFormat: 'json',
      squiss: {
        deleteMessage: (toDel) => {
          toDel.should.equal(msg)
          done()
        }
      }
    })
    msg.del()
  })
  it('calls Squiss.handledMessage on keep', (done) => {
    const msg = new Message({
      msg: getSQSMsg('{"Message":"foo","bar":"baz"}'),
      bodyFormat: 'json',
      squiss: {
        handledMessage: () => done()
      }
    })
    msg.keep()
  })
  it('treats del() and keep() as idempotent', () => {
    let calls = 0
    const msg = new Message({
      msg: getSQSMsg('{"Message":"foo","bar":"baz"}'),
      bodyFormat: 'json',
      squiss: {
        deleteMessage: () => { calls += 1 },
        handledMessage: () => { calls += 10 }
      }
    })
    msg.del()
    msg.keep()
    msg.del()
    calls.should.equal(1)
  })
  it('calls Squiss.changeMessageVisibility on changeVisibility', (done) => {
    const timeout = 10
    const message = new Message({
      msg: getSQSMsg('{"Message":"foo","bar":"baz"}'),
      bodyFormat: 'json',
      squiss: {
        changeMessageVisibility: (msg, timeoutInSeconds) => {
          msg.should.be.eql(message)
          timeoutInSeconds.should.be.eql(timeout)
          done()
        }
      }
    })
    message.changeVisibility(timeout)
  })
  it('calls Squiss.changeMessageVisibility with 0 on release', (done) => {
    const message = new Message({
      msg: getSQSMsg('{"Message":"foo","bar":"baz"}'),
      bodyFormat: 'json',
      squiss: {
        changeMessageVisibility: (msg, timeoutInSeconds) => {
          msg.should.be.eql(message)
          timeoutInSeconds.should.be.eql(0)
          done()
        }
      }
    })
    message.release()
  })
})

