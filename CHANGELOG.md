# Squiss Change Log
This project adheres to [Semantic Versioning](http://semver.org/).

## [Development]
Nothing yet!

## [v2.2.0]
### Added
- The `advancedCallMs` option to tweak how far in advance of a message's VisibilityTimeout that a ChangeVisibilityTimeout call will be made

### Fixed
- A possible scenario where someone could set the visibilityTimeoutSecs ultra low and cause timers to be set for negative milliseconds

## [v2.1.1]
### Fixed
- The option `noExtensionsAfterSecs` now defaults to seconds instead of milliseconds

## [v2.1.0]
### Added
- The `autoExtendFail` event, fired when the TimeoutExtender fails to change the VisibilityTimeout of a message due to the message no longer existing or being expired. This event may encompass more errors in the future.

### Fixed
- TimeoutExtender no longer continually tries to extend messages that SQS has reported as previously deleted or expired. Instead, messages are removed from the list on this error, and a `autoExtendFail` event is emitted.
- TimeoutExtender no longer tries to extend the timeout beyond AWS's maximum message lifetime.

## [v2.0.2]
### Fixed
- Message now passes an instance of itself to the handled call, fixing cases where the message would not be emitted with the "handled" event.

## [v2.0.1]
### Fixed
- TimeoutExtender now passes seconds to `changeMessageVisibility` instead of milliseconds. AWS didn't like that.

## [v2.0.0]
### Added
- The `deleted` event, fired when a message has been confirmed to be successfully deleted
- The `delQueued` event, fired when a message deletion has been queued up for the next batch
- The `handled` event, fired when a message has been handled by any means (kept, deleted, or released)
- The `released` event, fired when a message has been confirmed to be successfully released back for immediate availability
- The TimeoutExtender feature, which can automatically extend the VisibilityTimeout of any message that has not yet been handled. See README for details!
- The `autoExtendTimeout` and `noExtensionsAfterSecs` options to support the TimeoutExtender feature
- The `getQueueVisibilityTimeout` function. Intuitively, this gets the queue's VisibilityTimeout.
- `opts.SQS` now supports an instance of the SQS client class in addition to a constructor (cwhenderson20)

### Changed
- BREAKING: The `deleteMessage` method now requires a Message object to be passed to it; not just the receiptHandle
- BREAKING: The `releaseMessage` method now requires a Message object to be passed to it; not just the receiptHandle
- BREAKING: The `handledMessage` method now requires a Message object to be passed to it
- The `start()` function now returns a Promise that resolves when the poller has started

## [v1.1.0]
### Added
- You can now pass an SQS constructor from your own aws-sdk version instead of using the one packaged with Squiss (cwhenderson20)
- The visibilityTimeout of a received message can now be changed with `squiss.changeMessageVisibility` and `message.changeVisibility` (tothandras)
- A message can now be returned to the queue and made immediately available with `message.release` (tothandras)
- Messages can also be returned to the queue with immediate availablility through `squiss.releaseMessage`

### Fixed
- Deleting messages by handle now works. The Message ID used will be the position of the message in the delete queue, 1-indexed. ([#13](https://github.com/TechnologyAdvice/Squiss/issues/13))

### Changed
- Tests now use dirty-chai to work around Chai's cardinal sin of allowing nonexistent assertions to be called without error
- Tests now use chai-as-promised to assert promise results

## [v1.0.0]
### Added
- The `gotMessages` event, which fires when Squiss retrieves a new batch of messages from SQS
- The `maxInFlight` event, which fires when Squiss stops requesting new messages due to hitting the maxInFlight cap
- The `aborted` event, which fires when stop() is called during an active SQS receive message request
- Documentation for the already-existing `drained` event
- Documentation for the already-existing `sqs` property
- New option: `activePollIntervalMs`, allowing SQS requests to be spaced out when the queue has messages
- New option: `idlePollIntervalMs`, allowing SQS requests to be spaced out when the queue is empty
- `getQueueUrl` method to retrieve the configured queue's URL, even if only the name was provided to the constructor
- `createQueue` method to create the configured queue
- `deleteQueue` method to delete the configured queue
- `sendMessage` method to send a message to the configured queue
- `sendMessages` method to send an array of messages of any size (within reason) to the configured queue
- `deleteMessage` now accepts a ReceiptHandle string in lieu of a Message object, allowing messages to be deleted later without caching the full message itself.

### Changed
- Dropped support for Node 0.12. For Node 0.12 support, consider compiling with an ES6 transpiler such as Babel, or using version 0.7.
- Switched codebase to native ES6, updating to newest TechnologyAdvice style guide
- `stop()` now aborts any ongoing receiveMessage request by default. It also accepts a `soft` argument (boolean) to soft-stop the poller without the abort functionality.
- `opts.visibilityTimeout` has been renamed to `opts.visibilityTimeoutSecs` for consistency.

## [v0.7.0]
### Added
- pollRetryMs has been added to automatically restart the poller after a failed call to get new messages (dannyrscott)

## [v0.6.0]
### Added
- maxInFlight can now be set to 0 to uncap message flow (dannyrscott)

### Fixed
- In low-volume use cases, the delete timer would only fire once, and all other deletes depended on filling the queue (dannyrscott)

## [v0.5.1]
### Fixed
- Messages failed to stream appropriately when maxInFlight === receiveBatchSize (dannyrscott)

## [v0.5.0]
### Added
- Specifying unwrapSns now provides message.topicArn and message.topicName.

## [v0.4.0]
### Added
- Specifying unwrapSns now provides the SNS subject in the message.subject property (dannyrscott)
- An SQS request that ends with no messages now causes `queueEmpty` to be emitted with no arguments (dannyrscott)

## [v0.3.1]
### Fixed
- Squiss no longer crashes when no messages are found. Apparently we should have said "high volume only" instead of just "high volume".

## [v0.3.0]
### Added
- opts.correctQueueUrl added to support dynamic testing environments.

## [v0.2.0]
### Changed
- opts.msgFormat is now opts.bodyFormat to avoid confusion.

## v0.1.0
### Added
- Initial release

[Development]: https://github.com/TechnologyAdvice/Squiss/compare/v2.2.0...HEAD
[v2.2.0]: https://github.com/TechnologyAdvice/Squiss/compare/v2.1.1...v2.2.0
[v2.1.1]: https://github.com/TechnologyAdvice/Squiss/compare/v2.1.0...v2.1.1
[v2.1.0]: https://github.com/TechnologyAdvice/Squiss/compare/v2.0.2...v2.1.0
[v2.0.2]: https://github.com/TechnologyAdvice/Squiss/compare/v2.0.1...v2.0.2
[v2.0.1]: https://github.com/TechnologyAdvice/Squiss/compare/v2.0.0...v2.0.1
[v2.0.0]: https://github.com/TechnologyAdvice/Squiss/compare/v1.1.0...v2.0.0
[v1.1.0]: https://github.com/TechnologyAdvice/Squiss/compare/v1.0.0...v1.1.0
[v1.0.0]: https://github.com/TechnologyAdvice/Squiss/compare/v0.7.0...v1.0.0
[v0.7.0]: https://github.com/TechnologyAdvice/Squiss/compare/0.6.0...v0.7.0
[v0.6.0]: https://github.com/TechnologyAdvice/Squiss/compare/0.5.1...0.6.0
[v0.5.1]: https://github.com/TechnologyAdvice/Squiss/compare/0.5.0...0.5.1
[v0.5.0]: https://github.com/TechnologyAdvice/Squiss/compare/0.4.0...0.5.0
[v0.4.0]: https://github.com/TechnologyAdvice/Squiss/compare/0.3.1...0.4.0
[v0.3.1]: https://github.com/TechnologyAdvice/Squiss/compare/0.3.0...0.3.1
[v0.3.0]: https://github.com/TechnologyAdvice/Squiss/compare/0.2.0...0.3.0
[v0.2.0]: https://github.com/TechnologyAdvice/Squiss/compare/0.1.0...0.2.0
