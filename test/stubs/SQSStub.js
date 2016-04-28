/*
 * Copyright (c) 2015-2016 TechnologyAdvice
 */

'use strict'

const Bluebird = require('bluebird')

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

  deleteMessageBatchAsync(params) {
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
    return Bluebird.resolve(res)
  }

  getQueueUrlAsync(params) {
    return Promise.resolve({
      QueueUrl: `http://localhost:9324/queues/${params.QueueName}`
    })
  }

  receiveMessageAsync(query) {
    const msgs = this.msgs.splice(0, query.MaxNumberOfMessages)
    return new Bluebird((resolve) => {
      if (msgs.length) return resolve({Messages: msgs})
      return setTimeout(() => {
        resolve({})
      }, this.timeout * 1000)
    })
  }
}

module.exports = SQSStub
