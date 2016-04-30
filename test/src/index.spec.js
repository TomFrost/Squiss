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
})
