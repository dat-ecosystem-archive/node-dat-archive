## Node DatArchive

A nodejs API for Dat which is compatible with Beaker's DatArchive API. Useful for testing and for writing apps that work in the browser and in nodejs.

```js
var DatArchive = require('node-dat-archive')

// create a new archive
var archive = await DatArchive.create({
  localPath: './my-archive-data',
  title: 'My Archive',
  description: 'A test of the node DatArchive API'
})

// load an existing archive from disk
var archive = await DatArchive.load({
  localPath: './my-archive-data'
})

// load an existing archive from the URL:
var archive = new DatArchive(datURL, {localPath: './my-archive-data'})

// using the instance
await archive.writeFile('hello.txt', 'world')
var names = await archive.readdir('/')
console.log(names) // => ['hello.txt']
```

By default, `node-dat-archive` stores the Dat data in the `localPath` folder using the SLEEP format (dat's internal structure).
If you want the folder to show the latest files (the dat cli behavior) pass `latest: true`.

```js
var archive = await DatArchive.create({
  localPath: './my-archive-data',
  latest: true
})
var archive = await DatArchive.load({
  localPath: './my-archive-data',
  latest: true
})
var archive = new DatArchive(datURL, {
  localPath: './my-archive-data',
  latest: true
})
```

You can also pass options through to Dat with `datOptions`:

```js
var archive = new DatArchive(datURL, {
  localPath: './my-archive-data',
  datOptions: {
    live: true
  }
})
```

This will extend node-dat-archive's defaults.

### Differences from Browser API

 - This module adds the `localPath` parameter to `new DatArchive` and `DatArchive.create`. Use the `localPath` to specify where the data for the archive should be stored. If not provided, the archive will be stored in memory.
 - This module also adds `DatArchive.load()` to read an archive from disk.
 - This module does *yet* not include `DatArchive.fork`.
 - This module does *yet* not include `DatArchive.unlink`.
 - This module will not include `DatArchive.selectArchive`.
 - `archive.getInfo()` does not give a valid `mtime` or `size`.
 - `networked:` opt is not yet supported.

### Quick API reference

Refer to the [Beaker `DatArchive` docs](https://beakerbrowser.com/docs/apis/dat.html).

```js
var archive = new DatArchive(url, {localPath:, latest:})
var archive = await DatArchive.create({localPath:, latest:, title:, description:, type:, author:, networked:})
var archive = await DatArchive.load({localPath:, latest:})
var key = await DatArchive.resolveName(url)
archive.url
await archive.configure({title:, description:, type:, author:, networked:})
var info = await archive.getInfo({timeout:})
var stat = await archive.stat(path, {timeout:})
var content = await archive.readFile(path, {encoding:, timeout:})
var names = archive.readdir(path, {recursive:, stat:, timeout:})
await archive.writeFile(path, data, encoding)
await archive.mkdir(path)
await archive.unlink(path)
await archive.rmdir(path, {recursive:})
var history = await archive.history({start:, end:, reverse:, timeout:})
await archive.download(path, {timeout:})
var emitter = archive.createFileActivityStream(pattern)
var emitter = archive.createNetworkActivityStream()

// node-only:
archive._loadPromise // promise for when the archive is ready to use
archive._close() // exit swarm, close all files
```