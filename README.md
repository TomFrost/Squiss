# Squiss 
Large-pipe Amazon SQS Poller for Node.js

```javascript
var poller = new Squiss({
  queue: 'my-sqs-queue-url',
  msgFormat: 'json',
  unwrapSns: true,
  maxInFlight: 500
});
poller.start();

poller.on('message', function(msg) {
  console.log('%s says: %s', msg.body.name, msg.body.message);
  msg.del();
});
```

## License
All original content is Copyright (c) 2015 TechnologyAdvice, released under
the ultra-permissive ISC license. See LICENSE.txt for details.
