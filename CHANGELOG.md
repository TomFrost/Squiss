# Squiss Change Log
This project adheres to [Semantic Versioning](http://semver.org/).

## [Development]
Nothing yet!

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

[Development]: https://github.com/TechnologyAdvice/Squiss/compare/0.5.0...HEAD
[v0.4.0]: https://github.com/TechnologyAdvice/Squiss/compare/0.4.0...0.5.0
[v0.4.0]: https://github.com/TechnologyAdvice/Squiss/compare/0.3.1...0.4.0
[v0.3.1]: https://github.com/TechnologyAdvice/Squiss/compare/0.3.0...0.3.1
[v0.3.0]: https://github.com/TechnologyAdvice/Squiss/compare/0.2.0...0.3.0
[v0.2.0]: https://github.com/TechnologyAdvice/Squiss/compare/0.1.0...0.2.0
