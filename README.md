## Node DatArchive

A nodejs API for Dat which is compatible with Beaker's DatArchive API. Useful for testing and for writing apps that work in the browser and in nodejs.

```js
var DatArchive = require('node-dat-archive')

var archive = await DatArchive.create({
  localPath: './my-archive-data',
  title: 'My Archive',
  description: 'A test of the node DatArchive API'
})

var names = await archive.readdir('/')
console.log(names) // => ['index.html', 'images']

await archive.writeFile('hello.txt', 'world')
```

### Differences from Browser API

 - This module adds the `localPath` parameter to `new DatArchive` and `DatArchive.create`. Use the `localPath` to specify where the data for the archive should be stored. If not provided, the archive will be stored in memory.
 - This module does not include `DatArchive.fork`.
 - This module does not include `DatArchive.selectArchive`.
 - `archive.getInfo()` does not give a valid `mtime`, `metaSize`, or `stagingSize`
 - Unlike in the browser, this API does not have a staging area. All modifications are published immediately. The `diff()`, `commit()`, and `revert()` commands are noops.

### Quick API reference

Refer to the [Beaker `DatArchive` docs](https://beakerbrowser.com/docs/apis/dat.html).

```js
var archive = new DatArchive(url, {localPath:})
var archive = await DatArchive.create({localPath:, title:, description:})
var key = await DatArchive.resolveName(url)
archive.url
var info = await archive.getInfo({timeout:})
var stat = await archive.stat(path, {timeout:})
var content = await archive.readFile(path, {encoding:, timeout:})
var names = archive.readdir(path, {recursive:, stat:, timeout:})
await archive.writeFile(path, data, encoding)
await archive.mkdir(path)
await archive.unlink(path)
await archive.rmdir(path, {recursive:})
var changes = await archive.diff({shallow:, timeout:})
var changes = await archive.commit()
var changes = await archive.revert()
var history = await archive.history({start:, end:, reverse:, timeout:})
await archive.download(path, {timeout:})
var emitter = archive.createFileActivityStream(pattern)
var emitter = archive.createNetworkActivityStream()

// node-only:
archive._loadPromise // promise for when the archive is ready to use
archive._close() // exit swarm, close all files
```