/*
 * Copyright (c) 2015-2016 TechnologyAdvice
 */

'use strict'

const EventEmitter = require('events').EventEmitter

class SQSStub extends EventEmitter {
  constructor(msgCount, timeout) {
    super()
    this.msgs = []
    this.timeout = timeout === undefined ? 20 : timeout
    this.msgCount = msgCount
    this.config = {
      region: 'us-east-1',
      endpoint: 'http://foo.bar'
    }
    for (let i = 0; i < msgCount; i++) {
      this._addMessage(i)
    }
  }

  createQueue(params) {
    return this.getQueueUrl(params)
  }

  deleteMessageBatch(params) {
    return this._makeReq(() => {
      const res = {
        Successful: [],
        Failed: []
      }
      params.Entries.forEach((entry) => {
        if (parseInt(entry.ReceiptHandle, 10) < this.msgCount) {
          res.Successful.push({Id: entry.Id})
        } else {
          res.Failed.push({
            Id: entry.Id,
            SenderFault: true,
            Code: '404',
            Message: 'Does not exist'
          })
        }
      })
      return Promise.resolve(res)
    })
  }

  deleteQueue() {
    return this._makeReq(() => {
      return Promise.resolve({ ResponseMetadata: { RequestId: 'd2206b43-df52-5161-a8e8-24dc83737962' } })
    })
  }

  getQueueUrl(params) {
    return this._makeReq(() => {
      return Promise.resolve({
        QueueUrl: `http://localhost:9324/queues/${params.QueueName}`
      })
    })
  }

  receiveMessage(params) {
    return this._makeReq(() => {
      const msgs = this.msgs.splice(0, params.MaxNumberOfMessages)
      return new Promise((resolve, reject) => {
        if (msgs.length) return resolve({Messages: msgs})
        let removeListeners = () => {}
        const timeout = setTimeout(() => {
          removeListeners()
          resolve({})
        }, this.timeout)
        const onAbort = () => {
          removeListeners()
          const err = new Error('Request aborted by user')
          err.code = err.name = 'RequestAbortedError'
          err.retryable = false
          err.time = new Date()
          reject(err)
        }
        const onNewMessage = (msg) => {
          removeListeners()
          resolve({Messages: [msg]})
        }
        removeListeners = () => {
          clearTimeout(timeout)
          this.removeListener('newMessage', onNewMessage)
          this.removeListener('abort', onAbort)
        }
        this.once('abort', onAbort)
        this.once('newMessage', onNewMessage)
        return undefined
      })
    })
  }

  sendMessage(params) {
    this._addMessage(params.QueueUrl, params.MessageBody)
    return this._makeReq(() => {
      return Promise.resolve({
        MessageId: 'd2206b43-df52-5161-a8e8-24dc83737962',
        MD5OfMessageAttributes: 'deadbeefdeadbeefdeadbeefdeadbeef',
        MD5OfMessageBody: 'deadbeefdeadbeefdeadbeefdeadbeef'
      })
    })
  }

  sendMessageBatch(params) {
    const res = {
      Successful: [],
      Failed: []
    }
    params.Entries.forEach((entry, idx) => {
      if (entry.MessageBody !== 'FAIL') {
        this._addMessage(entry.Id, entry.MessageBody)
        res.Successful.push({
          Id: entry.Id,
          MessageId: idx.toString(),
          MD5OfMessageAttributes: 'deadbeefdeadbeefdeadbeefdeadbeef',
          MD5OfMessageBody: 'deadbeefdeadbeefdeadbeefdeadbeef'
        })
      } else {
        res.Failed.push({
          Id: entry.Id,
          SenderFault: true,
          Code: 'Message is empty',
          Message: ''
        })
      }
    })
    return this._makeReq(() => Promise.resolve(res))
  }

  _addMessage(id, body) {
    this.msgs.push({
      MessageId: `id_${id}`,
      ReceiptHandle: `${id}`,
      Body: body || `{"num": ${id}}`
    })
    this.emit('newMessage', this.msgs[this.msgs.length - 1])
  }

  _makeReq(func) {
    return {
      promise: func,
      abort: () => { this.emit('abort') }
    }
  }
}

module.exports = SQSStub
