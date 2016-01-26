# Squiss [![Build Status](https://travis-ci.org/TechnologyAdvice/Squiss.svg?branch=master)](https://travis-ci.org/TechnologyAdvice/Squiss) [![Code Climate](https://codeclimate.com/github/TechnologyAdvice/Squiss/badges/gpa.svg)](https://codeclimate.com/github/TechnologyAdvice/Squiss) [![Test Coverage](https://codeclimate.com/github/TechnologyAdvice/Squiss/badges/coverage.svg)](https://codeclimate.com/github/TechnologyAdvice/Squiss/coverage)
High-volume Amazon SQS Poller for Node.js

```javascript
const poller = new Squiss({
  queueName: 'my-sqs-queue',
  bodyFormat: 'json',
  unwrapSns: true,
  maxInFlight: 500
});
poller.start();

poller.on('message', (msg) => {
  console.log('%s says: %s', msg.body.name, msg.body.message);
  msg.del();
});
```

## How it works
Squiss aims to process as many messages simultaneously as possible. Set the `maxInFlight` option to the number of messages your app can handle at one time without choking, and Squiss will attempt to keep that many messages flowing through your app, grabbing more as you mark each message as handled or ready for deletion. If the queue is empty, Squiss will maintain an open connection to SQS, waiting for any messages that appear in real time.

## Functions

### new Squiss(opts)
Don't be scared of `new` -- you need to create a new Squiss instance for every queue you want to poll. Squiss is an EventEmitter, so don't forget to call `squiss.on('message', (msg) => msg.del())` at the very least.

#### opts {...}
- **opts.awsConfig** An object mapping to pass to the SQS constructor, configuring the aws-sdk library. This is commonly used to set the AWS region, or the user credentials. See the docs on [configuring the aws-sdk](http://docs.aws.amazon.com/AWSJavaScriptSDK/guide/node-configuring.html) for details.
- **opts.queueUrl** The URL of the queue to be polled. If not specified, opts.queueName is required.
- **opts.queueName** The name of the queue to be polled. Used only if opts.queueUrl is not specified.
- **opts.accountNumber** If a queueName is specified, the accountNumber of the queue owner can optionally be specified to access a queue in a different AWS account.
- **opts.correctQueueUrl** _Default false._ Changes the protocol, host, and port of the queue URL to match the configured SQS endpoint, applicable only if opts.queueName is specified. This can be useful for testing against a stubbed SQS service, such as ElasticMQ.
- **opts.deleteBatchSize** _Default 10._ The number of messages to delete at one time. Squiss will trigger a batch delete when this limit is reached, or when deleteWaitMs milliseconds have passed since the first queued delete in the batch; whichever comes first. Set to 1 to make all deletes immediate. Maximum 10.
- **opts.deleteWaitMs** _Default 2000._ The number of milliseconds to wait after the first queued message deletion before deleting the message(s) from SQS
- **opts.maxInFlight** _Default 100._ The number of messages to keep "in-flight", or processing simultaneously. When this cap is reached, no more messages will be polled until currently in-flight messages are marked as deleted or handled. Setting this option to false will uncap your inFlight messages, pulling and delivering messages as long as there are messages to pull.
- **opts.receiveBatchSize** _Default 10._ The number of messages to receive at one time. Maximum 10 or maxInFlight, whichever is lower.
- **opts.receiveWaitTimeSecs** _Default 20._ The number of seconds for which to hold open the SQS call to receive messages, when no message is currently available. It is recommended to set this high, as Squiss will re-open the receiveMessage HTTP request as soon as the last one ends. Maximum 20.
- **opts.unwrapSns** _Default false._ Set to `true` to denote that Squiss should treat each message as though it comes from a queue subscribed to an SNS endpoint, and automatically extract the message from the SNS metadata wrapper.
- **opts.bodyFormat** _Default "plain"._ The format of the incoming message. Set to "json" to automatically call `JSON.parse()` on each incoming message.
- **opts.visibilityTimeout** The SQS VisibilityTimeout to apply to each message. This is the number of seconds that each received message should be made inaccessible to other receive calls, so that a message will not be received more than once before it is processed and deleted. If not specified, the default for the SQS queue will be used.

### squiss.deleteMessage(Message)
Deletes a message. It's much easier to call `message.del()`, but if you need to do it right from the Squiss instance, this is how. Note that the message probably won't be deleted immediately -- it'll be queued for a batch delete. See the constructor notes for how to configure the specifics of that.

### squiss.handledMessage()
Informs Squiss that you got a message that you're not planning on deleting, so that Squiss can decrement the number of "in-flight" messages. It's good practice to delete every message you process, but this can be useful in case of error. You can also call `message.keep()` on the message itself to invoke this.

### squiss.start()
Starts polling SQS for new messages. Each new message is handed off in the `message` event.

### squiss.stop()
Hold on to your hats, this one stops the polling.

## Properties

### {number} squiss.inFlight
The number of messages currently in-flight.

### {boolean} squiss.running
`true` if Squiss is actively polling SQS. If it's not polling, we made the genius design decision to have this set to `false`.

## Events

### delError {Object}
A `delError` is emitted when AWS reports that any of the deleted messages failed to actually delete. The
object handed to you in this event is the AWS failure object described in the [SQS deleteMessageBatch documentation](http://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/SQS.html#getQueueUrl-property).

### error {Error}
If any of the AWS API calls outrightly fail, `error` is emitted. If you don't have a listener on `error`, per Node.js's structure, the error will be treated as uncaught and will crash your app.

### queueEmpty
A `queueEmpty` is emitted when no messages are received from getBatch

### message {Message}
Emitted every time Squiss pulls a new message from the queue. The Squiss Message object handed back has the following methods and properties:

#### {Object|string} message.body
The body of the SQS message, unwrapped from the SNS metadata wrapper (if `unwrapSns` was specified in the constructor), and JSON-parsed (if `bodyFormat: 'json'` was specified in the constructor). Otherwise the body will just be a string.

#### {string} message.subject
The subject of the SNS message, if set. Exists only if unwrapSns was specified.

#### {string} message.topicArn
The full SNS topic ARN to which this message was posted. Exists only if unwrapSns was specified.

#### {string} message.topicName
The name of the SNS topic to which this message was posted. Included for convenience only: this is the last segment of the topicArn. Exists only if unwrapSns was specified.

#### message.del()
Deletes the message from SQS. Either this or `message.keep()` _must_ be called on each message Squiss delivers in order to maintain an accurate inFlight count.

#### message.keep()
Instructs Squiss that you're not planning to delete a message, but it should no longer be considered "in-flight". Either this or `message.keep()` _must_ be called on each message Quiss delivers in order to maintain an accurate inFlight count.

#### {Object} message.raw
The raw, unprocessed SQS response object as delivered from the aws-sdk.

## License
Squiss is Copyright (c) 2015 TechnologyAdvice, released under the ultra-permissive ISC license. See LICENSE.txt for details.
