/*
 * Copyright (c) 2015-2016 TechnologyAdvice
 */

'use strict'

class SQSStub {
  constructor(msgCount, timeout) {
    this.msgs = []
    this.timeout = timeout === undefined ? 20 : timeout
    this.msgCount = msgCount
    this.config = {
      region: 'us-east-1',
      endpoint: 'http://foo.bar'
    }
    for (let i = 0; i < msgCount; i++) {
      this.msgs.push({
        MessageId: `id_${i}`,
        ReceiptHandle: `${i}`,
        body: `{"num": ${i}}`
      })
    }
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
        const timeout = setTimeout(() => {
          resolve({})
        }, this.timeout * 1000)
        this._makeAbort(reject, timeout)
        return undefined
      })
    })
  }

  _makeAbort(reject, timeout) {
    this._abort = () => {
      if (timeout) clearTimeout(timeout)
      const err = new Error('Request aborted by user')
      err.code = err.name = 'RequestAbortedError'
      err.retryable = false
      err.time = new Date()
      reject(err)
    }
  }

  _makeReq(func) {
    const nop = () => {}
    return {
      promise: func,
      abort: this._abort || nop
    }
  }
}

module.exports = SQSStub
