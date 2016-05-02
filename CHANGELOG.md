# Squiss Change Log
This project adheres to [Semantic Versioning](http://semver.org/).

## [Development]
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

[Development]: https://github.com/TechnologyAdvice/Squiss/compare/0.7.0...HEAD
[v0.6.0]: https://github.com/TechnologyAdvice/Squiss/compare/0.6.0...0.7.0
[v0.6.0]: https://github.com/TechnologyAdvice/Squiss/compare/0.5.1...0.6.0
[v0.5.1]: https://github.com/TechnologyAdvice/Squiss/compare/0.5.0...0.5.1
[v0.5.0]: https://github.com/TechnologyAdvice/Squiss/compare/0.4.0...0.5.0
[v0.4.0]: https://github.com/TechnologyAdvice/Squiss/compare/0.3.1...0.4.0
[v0.3.1]: https://github.com/TechnologyAdvice/Squiss/compare/0.3.0...0.3.1
[v0.3.0]: https://github.com/TechnologyAdvice/Squiss/compare/0.2.0...0.3.0
[v0.2.0]: https://github.com/TechnologyAdvice/Squiss/compare/0.1.0...0.2.0
