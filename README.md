# Squiss [![Build Status](https://travis-ci.org/TechnologyAdvice/Squiss.svg?branch=master)](https://travis-ci.org/TechnologyAdvice/Squiss) [![Code Climate](https://codeclimate.com/github/TechnologyAdvice/Squiss/badges/gpa.svg)](https://codeclimate.com/github/TechnologyAdvice/Squiss) [![Test Coverage](https://codeclimate.com/github/TechnologyAdvice/Squiss/badges/coverage.svg)](https://codeclimate.com/github/TechnologyAdvice/Squiss/coverage)
High-volume Amazon SQS Poller and single-queue client for Node.js 4 and up

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
Squiss aims to process as many messages simultaneously as possible. Set the `maxInFlight` option to the number of messages your app can handle at one time without choking, and Squiss will attempt to keep that many messages flowing through your app, grabbing more as you mark each message as handled or ready for deletion. If the queue is empty, Squiss will maintain an open connection to SQS, waiting for any messages that appear in real time. By default, anyway. You can configure it to poll however you want. Squiss don't care.

## Functions

### new Squiss(opts)
Don't be scared of `new` -- you need to create a new Squiss instance for every queue you want to poll. Squiss is an EventEmitter, so don't forget to call `squiss.on('message', (msg) => msg.del())` at the very least.

#### opts {...}
Use the following options to point Squiss at the right queue:
- **opts.awsConfig** An object mapping to pass to the SQS constructor, configuring the aws-sdk library. This is commonly used to set the AWS region, endpoint, or the user credentials. See the docs on [configuring the aws-sdk](http://docs.aws.amazon.com/AWSJavaScriptSDK/guide/node-configuring.html) for details.
- **opts.queueName** The name of the queue to be polled. Used only if opts.queueUrl is not specified, but Squiss prefers just the name.
- **opts.queueUrl** The URL of the queue to be polled. If not specified, opts.queueName is required.
- **opts.accountNumber** If a queueName is specified, the accountNumber of the queue owner can optionally be specified to access a queue in a different AWS account.
- **opts.correctQueueUrl** _Default false._ Changes the protocol, host, and port of the queue URL to match the configured SQS endpoint (see opts.awsConfig), applicable only if opts.queueName is specified. This can be useful for testing against a local SQS service, such as ElasticMQ.

Squiss's defaults are great out of the box for most use cases, but you can use the below to fine-tune your Squiss experience:
- **opts.SQS** _Default AWS.SQS_ An SQS constructor function to use rather than the default one provided by AWS.SQS
- **opts.activePollIntervalMs** _Default 0._ The number of milliseconds to wait between requesting batches of messages when the queue is not empty, and the maxInFlight cap has not been hit. For most use cases, it's better to leave this at 0 and let Squiss manage the active polling frequency according to maxInFlight.
- **opts.autoExtendTimeout** _Default false._ If true, Squiss will automatically extend each message's VisibilityTimeout in the SQS queue until it's handled (by keeping, deleting, or releasing it). It will place the API call to extend the timeout 5 seconds in advance of the expiration, and will extend it by the number of seconds specified in `opts.visibilityTimeoutSecs`. If that's not specified, the VisibilityTimeout setting on the queue itself will be used.
- **opts.bodyFormat** _Default "plain"._ The format of the incoming message. Set to "json" to automatically call `JSON.parse()` on each incoming message.
- **opts.deleteBatchSize** _Default 10._ The number of messages to delete at one time. Squiss will trigger a batch delete when this limit is reached, or when deleteWaitMs milliseconds have passed since the first queued delete in the batch; whichever comes first. Set to 1 to make all deletes immediate. Maximum 10.
- **opts.deleteWaitMs** _Default 2000._ The number of milliseconds to wait after the first queued message deletion before deleting the message(s) from SQS.
- **opts.idlePollIntervalMs** _Default 0._ The number of milliseconds to wait before requesting a batch of messages when the queue was empty on the prior request.
- **opts.maxInFlight** _Default 100._ The number of messages to keep "in-flight", or processing simultaneously. When this cap is reached, no more messages will be polled until currently in-flight messages are marked as deleted or handled. Setting this option to 0 will uncap your inFlight messages, pulling and delivering messages as long as there are messages to pull.
- **opts.noExtensionsAfterSecs** _Default 0._ If set above 0 and `opts.autoExtendTimeout` is used, Squiss will stop auto-renewing a message's VisibilityTimeout when it reaches this age.
- **opts.pollRetryMs** _Default 2000._ The number of milliseconds to wait before retrying when Squiss's call to retrieve messages from SQS fails.
- **opts.receiveBatchSize** _Default 10._ The number of messages to receive at one time. Maximum 10 or maxInFlight, whichever is lower.
- **opts.receiveWaitTimeSecs** _Default 20._ The number of seconds for which to hold open the SQS call to receive messages, when no message is currently available. It is recommended to set this high, as Squiss will re-open the receiveMessage HTTP request as soon as the last one ends. If this needs to be set low, consider setting activePollIntervalMs to space out calls to SQS. Maximum 20.
- **opts.unwrapSns** _Default false._ Set to `true` to denote that Squiss should treat each message as though it comes from a queue subscribed to an SNS endpoint, and automatically extract the message from the SNS metadata wrapper.
- **opts.visibilityTimeoutSecs** _Defaults to queue setting on read, or 30 seconds for createQueue._ The amount of time, in seconds, that received messages will be unavailable to other pollers without being deleted.

Are you using Squiss to create your queue, as well? Squiss will use `opts.receiveWaitTimeSecs` and `opts.visibilityTimeoutSecs` above in the queue settings, but consider setting any of the following options to configure it further. Note that the defaults are the same as Amazon's own:
- **opts.delaySecs** _Default 0._ The number of milliseconds by which to delay the delivery of new messages into the queue by default.
- **opts.maxMessageBytes** _Default 262144 (256KB)._ The maximum size of a single message, in bytes, that the queue can support.
- **opts.messageRetentionSecs** _Default 345600 (4 days)._ The amount of time for which to retain messages in the queue until they expire, in seconds. Maximum is 1209600 (14 days).
- **opts.queuePolicy** If specified, will be set as the access policy of the queue when `createQueue` is called. See [the AWS Policy documentation](http://docs.aws.amazon.com/IAM/latest/UserGuide/access_policies.html) for more information.

### squiss.createQueue()
Creates the configured queue! This returns a promise that resolves with the new queue's URL when it's complete. Note that this can only be called if you set `opts.queueName` when instantiating Squiss.

### squiss.deleteMessage(Message)
Deletes a message, given the full Message object sent to the `message` event. It's much easier to call `message.del()`, but if you need to do it right from the Squiss instance, this is how. Note that the message probably won't be deleted immediately -- it'll be queued for a batch delete. See the constructor notes for how to configure the specifics of that.

### squiss.changeMessageVisibility(Message|receiptHandle, timeoutInSeconds)
Changes the visibility timeout of a message, given either the full Squiss Message object or the receipt handle string.

### squiss.deleteQueue()
Deletes the configured queue, returning a promise that resolves on complete. Squiss lets you do this, even though it makes Squiss useless. Squiss is so selfless.

### squiss.getQueueUrl()
Returns a Promise that resolves with the URL of the configured queue, even if you only instantiated Squiss with a queueName. The correctQueueUrl setting applies to this result, if it was set.

### squiss.handledMessage(Message)
Informs Squiss that you got a message that you're not planning on deleting, so that Squiss can decrement the number of "in-flight" messages. It's good practice to delete every message you process, but this can be useful in case of error. You can also call `message.keep()` on the message itself to invoke this.

### squiss.releaseMessage(Message)
Releases the given Message object back to the queue by setting its `VisibilityTimeout` to `0` and marking the message as handled internally. You can also call `message.release()` on the message itself to invoke this.

### squiss.sendMessage(message, delay, attributes)
Sends an individual message to the configured queue, and returns a promise that resolves with AWS's official message metadata: an object containing `MessageId`, `MD5OfMessageAttributes`, and `MD5OfMessageBody`. Arguments:
- **message**. The message to push to the queue. If it's a string, great! If it's an Object, Squiss will call JSON.stringify on it.
- **delay** _optional_. The amount of time, in seconds, to wait before making the message available in the queue. If not specified, the queue's configured value will be used.
- **attributes** _optional_. An optional attributes mapping to associate with the message. For more information, see [the official AWS documentation](http://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/SQS.html#sendMessage-property).

### squiss.sendMessages(messages, delay, attributes)
Sends an array of any number of messages to the configured SQS queue, breaking them down into appropriate batch requests executed in parallel (or as much as the default HTTP agent allows). It returns a promise that resolves with a response closely aligned to the official AWS SDK's sendMessageBatch, except the results from all batch requests are merged. Expect a result similar to:

```javascript
{
  Successful: [
    {Id: string, MessageId: string, MD5OfMessageAttributes: string, MD5OfMessageBody: string}
  ],
  Failed: [
    {Id: string, SenderFault: boolean, Code: string, Message: string}
  ]
}
```

The "Id" supplied in the response will be the index of the message in the original messages array, in string form. Arguments:
- **messages**. The array of messages to push to the queue. The messages should be either strings, or Objects that Squiss can pass to JSON.stringify.
- **delay** _optional_. The amount of time, in seconds, to wait before making the messages available in the queue. If not specified, the queue's configured value will be used.
- **attributes** _optional_. An optional attributes mapping to associate with each message. For more information, see [the official AWS documentation](http://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/SQS.html#sendMessage-property).

### squiss.start()
Starts polling SQS for new messages. Each new message is handed off in the `message` event.

### squiss.stop(soft=`false`)
Hold on to your hats, this one stops the polling, aborting any in-progress request for new messages. If called with soft=`true` while there's an active request for new messages, the active request will not be aborted and the message event may still be fired up to `opts.receiveWaitTimeSecs` afterward.

## Properties

### {number} squiss.inFlight
The number of messages currently in-flight.

### {boolean} squiss.running
`true` if Squiss is actively polling SQS. If it's not polling, we made the genius design decision to have this set to `false`.

### {Object} squiss.sqs
For your convenience, Squiss provides direct access to the AWS SDK's SQS object, which can be handy for setting up or tearing down tests. No need to thank Squiss. Squiss does this because Squiss cares.

## Events

### deleted {Message}
Emitted when a message is confirmed as being successfully deleted from the queue. The `handled` and `delQueued` events will also be fired for deleted messages, but that will come earlier, when the delete function is initially called.

### delError {Object}
A `delError` is emitted when AWS reports that any of the deleted messages failed to actually delete. The
object handed to you in this event is the AWS failure object described in the [SQS deleteMessageBatch documentation](http://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/SQS.html#getQueueUrl-property).

### delQueued {Message}
Emitted when a message is queued for deletion, even if delete queuing has been turned off.

### drained
Emitted when the last in-flight message has been handled, and there are no more messages currently in flight.

### error {Error}
If any of the AWS API calls outrightly fail, `error` is emitted. If you don't have a listener on `error`, per Node.js's structure, the error will be treated as uncaught and will crash your app.

### gotMessages {number}
Emitted when Squiss asks SQS for a new batch of messages, and gets some (or one). Supplies the number of retrieved messages.

### handled {Message}
Emitted when a message is handled by any means: deleting, releasing, or calling `keep()` or `handledMessage()` on it. 

### queueEmpty
Emitted when Squiss asks SQS for new messages, and doesn't get any.

### released {Message}
Emitted after `release()` or `releaseMessage` has been called and the VisibilityTimeout of a message has successfully been changed to `0`. The `handled` event will also be fired for released messages, but that will come earlier, when the release function is initially called.
 
### timeoutExtended {Message}
Emitted when a message has had its timeout successfully extended by the `autoExtendTimeout` feature.

### aborted
Emitted after a hard stop() if a request for new messages was already in progress.

### maxInFlight
Emitted when Squiss has hit the maxInFlight cap. At this point, Squiss won't retrieve any more messages until at least `opts.receiveBatchSize` in-flight messages have been deleted.

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

#### message.release()
Changes the visibility timeout of the message to 0.

#### message.changeVisibility(timeoutInSeconds)
Changes the visibility timeout of the message.

#### {Object} message.raw
The raw, unprocessed SQS response object as delivered from the aws-sdk.

## Versions
Squiss supports Node 4 LTE and higher. For 0.12 support, consider compiling with Babel or using Squiss version 0.x.

## License
Squiss is Copyright (c) 2015 TechnologyAdvice, released under the ultra-permissive ISC license. See LICENSE.txt for details.
