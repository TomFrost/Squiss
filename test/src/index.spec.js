/*
 * Copyright (c) 2015-2016 TechnologyAdvice
 */

'use strict'

const AWS = require('aws-sdk')
const Squiss = require('src/index')
const SQSStub = require('test/stubs/SQSStub')
const delay = require('delay')

let inst = null
const origSQS = AWS.SQS
const wait = (ms) => delay(ms === undefined ? 20 : ms)

describe('index', () => {
  afterEach(() => {
    if (inst) inst.stop()
    inst = null
    AWS.SQS = origSQS
  })
  describe('constructor', () => {
    it('creates a new Squiss instance', () => {
      inst = new Squiss({
        queueUrl: 'foo',
        unwrapSns: true,
        visibilityTimeout: 10
      })
      should.exist(inst)
    })
    it('fails if queue is not specified', () => {
      let errored = false
      try {
        new Squiss()
      } catch (e) {
        should.exist(e)
        e.should.be.instanceOf(Error)
        errored = true
      }
      errored.should.be.true
    })
    it('provides a configured sqs client instance', () => {
      inst = new Squiss({
        queueUrl: 'foo',
        awsConfig: {
          region: 'us-east-1'
        }
      })
      inst.should.have.property('sqs')
      inst.sqs.should.be.an.Object
      inst.sqs.config.region.should.equal('us-east-1')
    })
  })
  describe('Receiving', () => {
    it('reports the appropriate "running" status', () => {
      inst = new Squiss({ queueUrl: 'foo' })
      inst._getBatch = () => {}
      inst.running.should.be.false
      inst.start()
      inst.running.should.be.true
    })
    it('treats start() as idempotent', () => {
      inst = new Squiss({ queueUrl: 'foo' })
      inst._getBatch = () => {}
      inst.running.should.be.false
      inst.start()
      inst.start()
      inst.running.should.be.true
    })
    it('receives a batch of messages under the max', () => {
      const spy = sinon.spy()
      inst = new Squiss({ queueUrl: 'foo' })
      inst.sqs = new SQSStub(5)
      inst.on('gotMessages', spy)
      inst.start()
      return wait().then(() => {
        spy.should.be.calledOnce
        spy.should.be.calledWith(5)
      })
    })
    it('receives batches of messages', () => {
      const batches = []
      const spy = sinon.spy()
      inst = new Squiss({ queueUrl: 'foo' })
      inst.sqs = new SQSStub(15, 0)
      inst.on('gotMessages', (count) => batches.push({total: count, num: 0}))
      inst.on('message', () => batches[batches.length - 1].num++)
      inst.once('queueEmpty', spy)
      inst.start()
      return wait().then(() => {
        spy.should.be.calledOnce
        batches.should.deep.equal([
          {total: 10, num: 10},
          {total: 5, num: 5}
        ])
      })
    })
    it('receives batches of messages when maxInflight = receiveBatchSize', () => {
      const batches = []
      const spy = sinon.spy()
      inst = new Squiss({ queueUrl: 'foo', maxInFlight: 10, receiveBatchSize: 10 })
      inst.sqs = new SQSStub(15, 0)
      inst.on('gotMessages', (count) => batches.push({total: count, num: 0}))
      inst.on('message', (m) => {
        batches[batches.length - 1].num++
        m.del()
      })
      inst.once('queueEmpty', spy)
      inst.start()
      return wait().then(() => {
        spy.should.be.calledOnce
        batches.should.deep.equal([
          {total: 10, num: 10},
          {total: 5, num: 5}
        ])
      })
    })
    it('emits queueEmpty event with no messages', () => {
      const msgSpy = sinon.spy()
      const qeSpy = sinon.spy()
      inst = new Squiss({ queueUrl: 'foo' })
      inst.sqs = new SQSStub(0, 0)
      inst.on('message', msgSpy)
      inst.once('queueEmpty', qeSpy)
      inst.start()
      return wait().then(() => {
        msgSpy.should.not.be.called
        qeSpy.should.be.calledOnce
      })
    })
    it('emits aborted when stopped with an active message req', () => {
      const spy = sinon.spy()
      inst = new Squiss({ queueUrl: 'foo' })
      inst.sqs = new SQSStub(0, 1000)
      inst.on('aborted', spy)
      inst.start()
      return wait().then(() => {
        spy.should.not.be.called
        inst.stop()
        return wait()
      }).then(() => {
        spy.should.be.calledOnce
      })
    })
    it('observes the maxInFlight cap', () => {
      const msgSpy = sinon.spy()
      const maxSpy = sinon.spy()
      inst = new Squiss({ queueUrl: 'foo', maxInFlight: 10 })
      inst.sqs = new SQSStub(15)
      inst.on('message', msgSpy)
      inst.on('maxInFlight', maxSpy)
      inst.start()
      return wait().then(() => {
        msgSpy.should.have.callCount(10)
        maxSpy.should.have.callCount(1)
      })
    })
    it('respects maxInFlight as 0 (no cap)', () => {
      const msgSpy = sinon.spy()
      const qeSpy = sinon.spy()
      const gmSpy = sinon.spy()
      inst = new Squiss({ queueUrl: 'foo', maxInFlight: 0 })
      inst.sqs = new SQSStub(35, 0)
      inst.on('message', msgSpy)
      inst.on('gotMessages', gmSpy)
      inst.once('queueEmpty', qeSpy)
      inst.start()
      return wait(50).then(() => {
        msgSpy.should.have.callCount(35)
        gmSpy.should.have.callCount(4)
        qeSpy.should.have.callCount(1)
      })
    })
    it('reports the correct number of inFlight messages', () => {
      const msgs = []
      inst = new Squiss({ queueUrl: 'foo', deleteWaitMs: 1 })
      inst.sqs = new SQSStub(5)
      inst.on('message', (msg) => msgs.push(msg))
      inst.start()
      return wait().then(() => {
        inst.inFlight.should.equal(5)
        inst.deleteMessage(msgs.pop())
        inst.handledMessage()
        return wait(1)
      }).then(() => {
        inst.inFlight.should.equal(3)
      })
    })
    it('pauses polling when maxInFlight is reached; resumes after', () => {
      const msgSpy = sinon.spy()
      const maxSpy = sinon.spy()
      inst = new Squiss({ queueUrl: 'foo', maxInFlight: 10 })
      inst.sqs = new SQSStub(11, 1000)
      inst.on('message', msgSpy)
      inst.on('maxInFlight', maxSpy)
      inst.start()
      return wait().then(() => {
        msgSpy.should.have.callCount(10)
        maxSpy.should.be.calledOnce
        for (let i = 0; i < 10; i++) {
          inst.handledMessage()
        }
        return wait()
      }).then(() => {
        msgSpy.should.have.callCount(11)
      })
    })
    it('observes the visibilityTimeout setting', () => {
      inst = new Squiss({ queueUrl: 'foo', visibilityTimeoutSecs: 10 })
      inst.sqs = new SQSStub()
      const spy = sinon.spy(inst.sqs, 'receiveMessage')
      inst.start()
      return wait().then(() => {
        spy.should.be.calledWith({
          QueueUrl: 'foo',
          MaxNumberOfMessages: 10,
          WaitTimeSeconds: 20,
          VisibilityTimeout: 10
        })
      })
    })
    it('observes activePollIntervalMs', () => {
      const abortSpy = sinon.spy()
      const gmSpy = sinon.spy()
      inst = new Squiss({ queueUrl: 'foo', activePollIntervalMs: 1000 })
      inst.sqs = new SQSStub(1, 0)
      inst.on('aborted', abortSpy)
      inst.on('gotMessages', gmSpy)
      inst.start()
      return wait().then(() => {
        gmSpy.should.be.calledOnce
        abortSpy.should.not.be.called
      })
    })
    it('observes idlePollIntervalMs', () => {
      const abortSpy = sinon.spy()
      const qeSpy = sinon.spy()
      inst = new Squiss({ queueUrl: 'foo', idlePollIntervalMs: 1000 })
      inst.sqs = new SQSStub(1, 0)
      inst.on('aborted', abortSpy)
      inst.on('queueEmpty', qeSpy)
      inst.start()
      return wait().then(() => {
        qeSpy.should.be.calledOnce
        abortSpy.should.not.be.called
      })
    })
  })
  describe('Deleting', () => {
    it('deletes messages using internal API', () => {
      const msgs = []
      inst = new Squiss({ queueUrl: 'foo', deleteWaitMs: 1 })
      inst.sqs = new SQSStub(5)
      const spy = sinon.spy(inst.sqs, 'deleteMessageBatch')
      inst.on('message', (msg) => msgs.push(msg))
      inst.start()
      return wait().then(() => {
        msgs.should.have.length(5)
        inst.deleteMessage(msgs.pop())
        return wait(10)
      }).then(() => {
        spy.should.be.calledOnce
      })
    })
    it('deletes messages using Message API', () => {
      const msgs = []
      inst = new Squiss({ queueUrl: 'foo', deleteWaitMs: 1 })
      inst.sqs = new SQSStub(5)
      const spy = sinon.spy(inst.sqs, 'deleteMessageBatch')
      inst.on('message', (msg) => msgs.push(msg))
      inst.start()
      return wait().then(() => {
        msgs.should.have.length(5)
        msgs.pop().del()
        return wait(10)
      }).then(() => {
        spy.should.be.calledOnce
      })
    })
    it('deletes messages in batches', () => {
      inst = new Squiss({ queueUrl: 'foo', deleteWaitMs: 10 })
      inst.sqs = new SQSStub(15)
      const spy = sinon.spy(inst.sqs, 'deleteMessageBatch')
      inst.on('message', (msg) => msg.del())
      inst.start()
      return wait().then(() => {
        spy.should.be.calledTwice
      })
    })
    it('deletes immediately with batch size=1', () => {
      inst = new Squiss({ queueUrl: 'foo', deleteBatchSize: 1 })
      inst.sqs = new SQSStub(5)
      const spy = sinon.spy(inst.sqs, 'deleteMessageBatch')
      inst.on('message', (msg) => msg.del())
      inst.start()
      return wait().then(() => {
        spy.should.have.callCount(5)
      })
    })
    it('delWaitTime timeout should be cleared after timeout runs', () => {
      const msgs = []
      inst = new Squiss({ queueUrl: 'foo', deleteBatchSize: 10, deleteWaitMs: 10})
      inst.sqs = new SQSStub(2)
      const spy = sinon.spy(inst, '_deleteMessages')
      inst.on('message', (msg) => msgs.push(msg))
      inst.start()
      return wait().then(() => {
        inst.stop()
        msgs[0].del()
        return wait(15)
      }).then(() => {
        spy.should.be.calledOnce
        msgs[1].del()
        return wait(15)
      }).then(() => {
        spy.should.be.calledTwice
      })
    })
  })
  describe('Failures', () => {
    it('emits delError when a message fails to delete', () => {
      const spy = sinon.spy()
      inst = new Squiss({ queueUrl: 'foo', deleteBatchSize: 1 })
      inst.sqs = new SQSStub(1)
      inst.on('delError', spy)
      inst.deleteMessage({
        raw: {
          MessageId: 'foo',
          ReceiptHandle: 'bar'
        }
      })
      return wait().then(() => {
        spy.should.be.calledOnce
        spy.should.be.calledWith({ Code: '404', Id: 'foo', Message: 'Does not exist', SenderFault: true })
      })
    })
    it('emits error when delete call fails', () => {
      const spy = sinon.spy()
      inst = new Squiss({ queueUrl: 'foo', deleteBatchSize: 1 })
      inst.sqs = new SQSStub(1)
      inst.sqs.deleteMessageBatch = () => {
        return {
          promise: () => Promise.reject(new Error('test'))
        }
      }
      inst.on('error', spy)
      inst.deleteMessage({
        raw: {
          MessageId: 'foo',
          ReceiptHandle: 'bar'
        }
      })
      return wait().then(() => {
        spy.should.be.calledOnce
        spy.should.be.calledWith(sinon.match.instanceOf(Error))
      })
    })
    it('emits error when receive call fails', () => {
      const spy = sinon.spy()
      inst = new Squiss({ queueUrl: 'foo' })
      inst.sqs = new SQSStub(1)
      inst.sqs.receiveMessage = () => {
        return {
          promise: () => Promise.reject(new Error('test')),
          abort: () => {}
        }
      }
      inst.on('error', spy)
      inst.start()
      return wait().then(() => {
        spy.should.be.calledOnce
        spy.should.be.calledWith(sinon.match.instanceOf(Error))
      })
    })
    it('attempts to restart polling after a receive call fails', () => {
      const msgSpy = sinon.spy()
      const errSpy = sinon.spy()
      inst = new Squiss({ queueUrl: 'foo', receiveBatchSize: 1, pollRetryMs: 5})
      inst.sqs = new SQSStub(2)
      sinon.stub(inst.sqs, 'receiveMessage', () => {
        inst.sqs.receiveMessage.restore()
        return {
          promise: () => Promise.reject(new Error('test')),
          abort: () => {}
        }
      })
      inst.on('message', msgSpy)
      inst.on('error', errSpy)
      inst.start()
      return wait().then(() => {
        errSpy.should.be.calledOnce
        msgSpy.should.be.calledTwice
      })
    })
    it('emits error when GetQueueURL call fails', () => {
      const spy = sinon.spy()
      inst = new Squiss({ queueName: 'foo' })
      inst.sqs.getQueueUrl = () => {
        return {
          promise: () => Promise.reject(new Error('test'))
        }
      }
      inst.on('error', spy)
      inst.start()
      return wait().then(() => {
        spy.should.be.calledOnce
        spy.should.be.calledWith(sinon.match.instanceOf(Error))
      })
    })
  })
  describe('Testing', () => {
    it('allows queue URLs to be corrected to the endpoint hostname', () => {
      inst = new Squiss({ queueName: 'foo', correctQueueUrl: true })
      inst.sqs = new SQSStub(1)
      return inst.getQueueUrl().then((url) => {
        url.should.equal('http://foo.bar/queues/foo')
      })
    })
  })
  describe('createQueue', () => {
    it('rejects if Squiss was instantiated without queueName', () => {
      inst = new Squiss({ queueUrl: 'foo' })
      inst.sqs = new SQSStub(1)
      return inst.createQueue().should.be.rejected
    })
    it('calls SQS SDK createQueue method with default attributes', () => {
      inst = new Squiss({ queueName: 'foo' })
      inst.sqs = new SQSStub(1)
      const spy = sinon.spy(inst.sqs, 'createQueue')
      return inst.createQueue().then((queueUrl) => {
        queueUrl.should.be.a.string
        spy.should.be.calledOnce
        spy.should.be.calledWith({
          QueueName: 'foo',
          Attributes: {
            ReceiveMessageWaitTimeSeconds: '20',
            DelaySeconds: '0',
            MaximumMessageSize: '262144',
            MessageRetentionPeriod: '345600'
          }
        })
      })
    })
    it('configures VisibilityTimeout if specified', () => {
      inst = new Squiss({ queueName: 'foo', visibilityTimeoutSecs: 15 })
      inst.sqs = new SQSStub(1)
      const spy = sinon.spy(inst.sqs, 'createQueue')
      return inst.createQueue().then((queueUrl) => {
        queueUrl.should.be.a.string
        spy.should.be.calledOnce
        spy.should.be.calledWith({
          QueueName: 'foo',
          Attributes: {
            ReceiveMessageWaitTimeSeconds: '20',
            DelaySeconds: '0',
            MaximumMessageSize: '262144',
            MessageRetentionPeriod: '345600',
            VisibilityTimeout: '15'
          }
        })
      })
    })
    it('calls SQS SDK createQueue method with custom attributes', () => {
      inst = new Squiss({
        queueName: 'foo',
        receiveWaitTimeSecs: 10,
        delaySecs: 300,
        maxMessageBytes: 100,
        messageRetentionSecs: 60,
        visibilityTimeoutSecs: 10,
        queuePolicy: {foo: 'bar'}
      })
      inst.sqs = new SQSStub(1)
      const spy = sinon.spy(inst.sqs, 'createQueue')
      return inst.createQueue().then((queueUrl) => {
        queueUrl.should.be.a.string
        spy.should.be.calledOnce
        spy.should.be.calledWith({
          QueueName: 'foo',
          Attributes: {
            ReceiveMessageWaitTimeSeconds: '10',
            DelaySeconds: '300',
            MaximumMessageSize: '100',
            MessageRetentionPeriod: '60',
            VisibilityTimeout: '10',
            Policy: {foo: 'bar'}
          }
        })
      })
    })
  })
  describe('deleteQueue', () => {
    it('calls SQS SDK deleteQueue method with queue URL', () => {
      inst = new Squiss({ queueUrl: 'foo' })
      inst.sqs = new SQSStub(1)
      const spy = sinon.spy(inst.sqs, 'deleteQueue')
      return inst.deleteQueue().then((res) => {
        res.should.be.an.object
        spy.should.be.calledOnce
        spy.should.be.calledWith({ QueueUrl: 'foo' })
      })
    })
  })
  describe('getQueueUrl', () => {
    it('resolves with the provided queueUrl without hitting SQS', () => {
      inst = new Squiss({ queueUrl: 'foo' })
      inst.sqs = new SQSStub(1)
      const spy = sinon.spy(inst.sqs, 'getQueueUrl')
      return inst.getQueueUrl((queueUrl) => {
        queueUrl.should.equal('foo')
        spy.should.not.be.called
      })
    })
    it('asks SQS for the URL if queueUrl was not provided', () => {
      inst = new Squiss({ queueName: 'foo' })
      inst.sqs = new SQSStub(1)
      const spy = sinon.spy(inst.sqs, 'getQueueUrl')
      return inst.getQueueUrl((queueUrl) => {
        queueUrl.indexOf('http').should.equal(0)
        spy.should.be.calledOnce
        spy.should.be.calledWith({ QueueName: 'foo' })
      })
    })
    it('caches the queueUrl after the first call to SQS', () => {
      inst = new Squiss({ queueName: 'foo' })
      inst.sqs = new SQSStub(1)
      const spy = sinon.spy(inst.sqs, 'getQueueUrl')
      return inst.getQueueUrl(() => {
        spy.should.be.calledOnce
        return inst.getQueueUrl()
      }).then(() => {
        spy.should.be.calledOnce
      })
    })
    it('includes the account number if provided', () => {
      inst = new Squiss({ queueName: 'foo', accountNumber: 1234 })
      inst.sqs = new SQSStub(1)
      const spy = sinon.spy(inst.sqs, 'getQueueUrl')
      return inst.getQueueUrl((queueUrl) => {
        queueUrl.indexOf('http').should.equal(0)
        spy.should.be.calledOnce
        spy.should.be.calledWith({
          QueueName: 'foo',
          QueueOwnerAWSAccountId: '1234'
        })
      })
    })
  })
  describe('sendMessage', () => {
    it('sends a string message with no extra arguments', () => {
      inst = new Squiss({ queueUrl: 'foo' })
      inst.sqs = new SQSStub()
      const spy = sinon.spy(inst.sqs, 'sendMessage')
      return inst.sendMessage('bar').then(() => {
        spy.should.be.calledOnce
        spy.should.be.calledWith({ QueueUrl: 'foo', MessageBody: 'bar' })
      })
    })
    it('sends a JSON message with no extra arguments', () => {
      inst = new Squiss({ queueUrl: 'foo' })
      inst.sqs = new SQSStub()
      const spy = sinon.spy(inst.sqs, 'sendMessage')
      return inst.sendMessage({ bar: 'baz' }).then(() => {
        spy.should.be.calledOnce
        spy.should.be.calledWith({ QueueUrl: 'foo', MessageBody: '{"bar":"baz"}' })
      })
    })
    it('sends a message with a delay and attributes', () => {
      inst = new Squiss({ queueUrl: 'foo' })
      inst.sqs = new SQSStub()
      const spy = sinon.spy(inst.sqs, 'sendMessage')
      return inst.sendMessage('bar', 10, { baz: 'fizz' }).then(() => {
        spy.should.be.calledWith({
          QueueUrl: 'foo',
          MessageBody: 'bar',
          DelaySeconds: 10,
          MessageAttributes: { baz: 'fizz' }
        })
      })
    })
  })
  describe('sendMessages', () => {
    it('sends a single string message with no extra arguments', () => {
      inst = new Squiss({ queueUrl: 'foo' })
      inst.sqs = new SQSStub()
      const spy = sinon.spy(inst.sqs, 'sendMessageBatch')
      return inst.sendMessages('bar').then((res) => {
        spy.should.be.calledOnce
        spy.should.be.calledWith({
          QueueUrl: 'foo',
          Entries: [
            { Id: '0', MessageBody: 'bar' }
          ]
        })
        res.should.have.property('Successful').with.length(1)
        res.Successful[0].should.have.property('Id').equal('0')
      })
    })
    it('sends a single JSON message with no extra arguments', () => {
      inst = new Squiss({ queueUrl: 'foo' })
      inst.sqs = new SQSStub()
      const spy = sinon.spy(inst.sqs, 'sendMessageBatch')
      return inst.sendMessages({bar: 'baz'}).then(() => {
        spy.should.be.calledOnce
        spy.should.be.calledWith({
          QueueUrl: 'foo',
          Entries: [
            { Id: '0', MessageBody: '{"bar":"baz"}' }
          ]
        })
      })
    })
    it('sends a single message with delay and attributes', () => {
      inst = new Squiss({ queueUrl: 'foo' })
      inst.sqs = new SQSStub()
      const spy = sinon.spy(inst.sqs, 'sendMessageBatch')
      return inst.sendMessages('bar', 10, { baz: 'fizz' }).then(() => {
        spy.should.be.calledOnce
        spy.should.be.calledWith({
          QueueUrl: 'foo',
          Entries: [{
            Id: '0',
            MessageBody: 'bar',
            DelaySeconds: 10,
            MessageAttributes: { baz: 'fizz' }
          }]
        })
      })
    })
    it('sends multiple batches of messages and merges successes', () => {
      inst = new Squiss({ queueUrl: 'foo' })
      inst.sqs = new SQSStub()
      const spy = sinon.spy(inst.sqs, 'sendMessageBatch')
      const msgs = 'a.b.c.d.e.f.g.h.i.j.k.l.m.n.o'.split('.')
      return inst.sendMessages(msgs).then((res) => {
        spy.should.be.calledTwice
        inst.sqs.msgs.length.should.equal(15)
        res.should.have.property('Successful').with.length(15)
        res.should.have.property('Failed').with.length(0)
      })
    })
    it('sends multiple batches of messages and merges failures', () => {
      inst = new Squiss({ queueUrl: 'foo' })
      inst.sqs = new SQSStub()
      const spy = sinon.spy(inst.sqs, 'sendMessageBatch')
      const msgs = 'a.FAIL.c.d.e.f.g.h.i.j.k.l.m.n.FAIL'.split('.')
      return inst.sendMessages(msgs).then((res) => {
        spy.should.be.calledTwice
        inst.sqs.msgs.length.should.equal(13)
        res.should.have.property('Successful').with.length(13)
        res.should.have.property('Failed').with.length(2)
      })
    })
  })
  describe('Deprecations', () => {
    it('writes to stderr when visibilityTimeout is used', () => {
      const stub = sinon.stub(process.stderr, 'write', () => {})
      inst = new Squiss({ queueUrl: 'foo', visibilityTimeout: 30})
      stub.should.be.calledOnce
      stub.restore()
      inst._opts.should.have.property('visibilityTimeoutSecs').equal(30)
    })
  })
})
