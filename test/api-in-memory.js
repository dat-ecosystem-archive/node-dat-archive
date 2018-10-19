const test = require('ava')
const os = require('os')
const path = require('path')
const fs = require('fs')
const tempy = require('tempy')
const {shareDat, createDat} = require('./lib/dat-helpers')
const DatArchive = require('../')

var testStaticDat, testStaticDatURL
var createdArchive
var fakeDatURL = 'dat://' + ('f'.repeat(64)) + '/'
var beakerPng = fs.readFileSync(__dirname + '/scaffold/test-static-dat/beaker.png')

test.before(async t => {
  // share the test static dat
  testStaticDat = await shareDat(__dirname + '/scaffold/test-static-dat')
  testStaticDatURL = 'dat://' + testStaticDat.archive.key.toString('hex') + '/'
})

// tests
//

test('archive.readdir', async t => {
  var archive = new DatArchive(testStaticDatURL)

  // root dir
  let listing1 = await archive.readdir('/')
  t.deepEqual(listing1.sort(), ['beaker.png', 'hello.txt', 'subdir'])

  // subdir
  let listing2 = await archive.readdir('/subdir')
  t.deepEqual(listing2.sort(), ['hello.txt', 'space in the name.txt'])

  // root dir stat=true
  let listing3 = await archive.readdir('/', {stat: true})
  listing3 = listing3.sort()
  t.is(listing3[0].name, 'beaker.png')
  t.truthy(listing3[0].stat)
  t.is(listing3[1].name, 'hello.txt')
  t.truthy(listing3[1].stat)
  t.is(listing3[2].name, 'subdir')
  t.truthy(listing3[2].stat)

  // subdir stat=true
  let listing4 = await archive.readdir('/subdir', {stat: true})
  listing4 = listing4.sort()
  t.is(listing4[0].name, 'hello.txt')
  t.truthy(listing4[0].stat)
  t.is(listing4[1].name, 'space in the name.txt')
  t.truthy(listing4[1].stat)
})

test('archive.readFile', async t => {
  var archive = new DatArchive(testStaticDatURL)

  // read utf8
  var helloTxt = await archive.readFile('hello.txt')
  t.deepEqual(helloTxt, 'hello')

  // read utf8 2
  var helloTxt2 = await archive.readFile('/subdir/hello.txt', 'utf8')
  t.deepEqual(helloTxt2, 'hi')

  // read utf8 when spaces are in the name
  var helloTxt2 = await archive.readFile('/subdir/space in the name.txt', 'utf8')
  t.deepEqual(helloTxt2, 'hi')

  // read hex
  var beakerPngHex = await archive.readFile('beaker.png', 'hex')
  t.deepEqual(beakerPngHex, beakerPng.toString('hex'))

  // read base64
  var beakerPngBase64 = await archive.readFile('beaker.png', 'base64')
  t.deepEqual(beakerPngBase64, beakerPng.toString('base64'))

  // read binary
  var beakerPngBinary = await archive.readFile('beaker.png', 'binary')
  t.truthy(beakerPng.equals(beakerPngBinary))

  // timeout: read an archive that does not exist
  var badArchive = new DatArchive(fakeDatURL)
  await t.throws(badArchive.readFile('hello.txt', { timeout: 500 }))
})

test('archive.stat', async t => {
  var archive = new DatArchive(testStaticDatURL)

  // stat root file
  var entry = await archive.stat('hello.txt')
  t.deepEqual(entry.isFile(), true, 'root file')

  // stat subdir file
  var entry = await archive.stat('subdir/hello.txt')
  t.deepEqual(entry.isFile(), true, 'subdir file')

  // stat subdir
  var entry = await archive.stat('subdir')
  t.deepEqual(entry.isDirectory(), true, 'subdir')

  // stat non-existent file
  await t.throws(archive.stat('notfound'))

  // stat alt-formed path
  var entry = await archive.stat('/hello.txt')
  t.deepEqual(entry.isFile(), true, 'alt-formed path')

  // stat path w/spaces in it
  var entry = await archive.stat('/subdir/space in the name.txt')
  t.deepEqual(entry.isFile(), true, 'path w/spaces in it')

  // stat path w/spaces in it
  var entry = await archive.stat('/subdir/space%20in%20the%20name.txt')
  t.deepEqual(entry.isFile(), true, 'path w/spaces in it')

  // timeout: stat an archive that does not exist
  var badArchive = new DatArchive(fakeDatURL)
  await t.throws(badArchive.stat('hello.txt', { timeout: 500 }))
})

test('DatArchive.create', async t => {
  // create it
  createdArchive = await DatArchive.create({
    title: 'The Title',
    description: 'The Description'
  })

  // check the dat.json
  var manifest = JSON.parse(await createdArchive.readFile('dat.json'))
  t.deepEqual(manifest.title, 'The Title')
  t.deepEqual(manifest.description, 'The Description')
})

test('archive.configure', async t => {
  // configure it
  await createdArchive.configure({
    title: 'The New Title',
    description: 'The New Description'
  })

  // check the dat.json
  var manifest = JSON.parse(await createdArchive.readFile('dat.json'))
  t.deepEqual(manifest.title, 'The New Title')
  t.deepEqual(manifest.description, 'The New Description')
})

test('archive.writeFile', async t => {
  async function dotest (filename, content, encoding) {
    // write to the top-level
    await createdArchive.writeFile(filename, content, encoding)

    // read it back
    var res = await createdArchive.readFile(filename, encoding)
    if (encoding === 'binary') {
      t.truthy(content.equals(res))
    } else {
      t.deepEqual(res, content)
    }
  }

  var beakerPng = fs.readFileSync(__dirname + '/scaffold/test-static-dat/beaker.png')
  await dotest('hello.txt', 'hello world', 'utf8')
  await dotest('beaker1.png', beakerPng, 'binary')
  await dotest('beaker2.png', beakerPng.toString('base64'), 'base64')
  await dotest('beaker3.png', beakerPng.toString('hex'), 'hex')
})

test('archive.writeFile gives an error for malformed names', async t => {
  await t.throws(createdArchive.writeFile('/', 'hello world'))
  await t.throws(createdArchive.writeFile('/subdir/hello.txt/', 'hello world'))
  await t.throws(createdArchive.writeFile('hello`.txt', 'hello world'))
})

test('archive.writeFile protects the manifest', async t => {
  await t.throws(createdArchive.writeFile('dat.json', 'hello world'))
})

test('archive.mkdir', async t => {
  await createdArchive.mkdir('subdir')
  var res = await createdArchive.stat('subdir')
  t.deepEqual(res.isDirectory(), true)
})

test('archive.writeFile writes to subdirectories', async t => {
  await createdArchive.writeFile('subdir/hello.txt', 'hello world', 'utf8')
  var res = await createdArchive.readFile('subdir/hello.txt', 'utf8')
  t.deepEqual(res, 'hello world')
})

test('versioned reads and writes', async t => {
  // create a fresh dat
  var archive = await DatArchive.create({title: 'Another Test Dat'})

  // do some writes
  await archive.writeFile('/one.txt', 'a', 'utf8')
  await archive.writeFile('/two.txt', 'b', 'utf8')
  await archive.writeFile('/one.txt', 'c', 'utf8')

  // check history
  var history = await archive.history()
  if (history.length !== 4) {
    console.log('Weird history', history)
  }
  t.deepEqual(history.length, 4)

  // helper
  function checkout (v) {
    return new DatArchive(archive.url + v)
  }

  // read back versions
  t.deepEqual((await checkout('+1').readdir('/')).length, 1)
  t.deepEqual((await checkout('+2').readdir('/')).length, 2)
  t.deepEqual((await checkout('+3').readdir('/')).length, 3)
  t.deepEqual((await checkout('+2').readFile('/one.txt')), 'a')
  t.deepEqual((await checkout('+4').readFile('/one.txt')), 'c')
  var statRev2 = await checkout('+2').stat('/one.txt')
  var statRev4 = await checkout('+4').stat('/one.txt')
  t.truthy(statRev2.offset < statRev4.offset)
})

test('Fail to write to unowned archives', async t => {
  var archive = new DatArchive(testStaticDatURL)
  await t.throws(archive.writeFile('/denythis.txt', 'hello world', 'utf8'))
  await t.throws(archive.mkdir('/denythis'))
})

test('archive.getInfo', async t => {
  var archive = new DatArchive(testStaticDatURL)
  var info = await archive.getInfo()
  t.deepEqual(info.isOwner, false)
  t.deepEqual(info.version, 4)
})

test('archive.download', async t => {
  var archive = new DatArchive(testStaticDatURL)

  // ensure not yet downloaded
  var res = await archive.stat('/hello.txt')
  t.deepEqual(res.downloaded, 0)

  // download
  await archive.download('/hello.txt')

  // ensure downloaded
  var res = await archive.stat('/hello.txt')
  t.deepEqual(res.downloaded, res.blocks)

  // ensure not yet downloaded
  var res = await archive.stat('/subdir/hello.txt')
  t.deepEqual(res.downloaded, 0)

  // download
  await archive.download('/')

  // ensure downloaded
  var res = await archive.stat('/subdir/hello.txt')
  t.deepEqual(res.downloaded, res.blocks)
})

test('archive.watch', async t => {
  // create a fresh dat
  var archive = await DatArchive.create({title: 'Another Test Dat'})
  await archive._loadPromise

  // start the stream
  var res = []
  var events = archive.watch()
  events.addEventListener('changed', function ({path}) {
    res.push(path)
  })

  // make changes
  await archive.writeFile('/a.txt', 'one', 'utf8')
  await archive.writeFile('/b.txt', 'one', 'utf8')
  await archive.writeFile('/a.txt', 'one', 'utf8')
  await archive.writeFile('/a.txt', 'two', 'utf8')
  await archive.writeFile('/b.txt', 'two', 'utf8')
  await archive.writeFile('/c.txt', 'one', 'utf8')

  var n = 0
  while (res.length !== 6 && ++n < 10) {
    await sleep(500)
  }
  t.deepEqual(res, ['/a.txt', '/b.txt', '/a.txt', '/a.txt', '/b.txt', '/c.txt'])
})

test('archive.watch (onInvalidated)', async t => {
  // create a fresh dat
  var archive = await DatArchive.create({title: 'Another Test Dat'})
  await archive._loadPromise

  // start the stream
  var res = []
  archive.watch(function ({path}) {
    res.push(path)
  })

  // make changes
  await archive.writeFile('/a.txt', 'one', 'utf8')
  await archive.writeFile('/b.txt', 'one', 'utf8')
  await archive.writeFile('/a.txt', 'one', 'utf8')
  await archive.writeFile('/a.txt', 'two', 'utf8')
  await archive.writeFile('/b.txt', 'two', 'utf8')
  await archive.writeFile('/c.txt', 'one', 'utf8')

  var n = 0
  while (res.length !== 6 && ++n < 10) {
    await sleep(500)
  }
  t.deepEqual(res, ['/a.txt', '/b.txt', '/a.txt', '/a.txt', '/b.txt', '/c.txt'])
})

test('archive.watch (match filename)', async t => {
  // create a fresh dat
  var archive = await DatArchive.create({title: 'Another Test Dat'})
  await archive._loadPromise

  // start the stream
  var res = []
  archive.watch('/a.txt', function ({path}) {
    res.push(path)
  })

  // make changes
  await archive.writeFile('/a.txt', 'one', 'utf8')
  await archive.writeFile('/b.txt', 'one', 'utf8')
  await archive.writeFile('/a.txt', 'one', 'utf8')
  await archive.writeFile('/a.txt', 'two', 'utf8')
  await archive.writeFile('/b.txt', 'two', 'utf8')
  await archive.writeFile('/c.txt', 'one', 'utf8')

  var n = 0
  while (res.length !== 3 && ++n < 10) {
    await sleep(500)
  }
  t.deepEqual(res, ['/a.txt', '/a.txt', '/a.txt'])
})

test('archive.watch (glob)', async t => {
  // create a fresh dat
  var archive = await DatArchive.create({title: 'Another Test Dat'})
  await archive._loadPromise

  // start the stream
  var res = []
  archive.watch('/*.txt', function ({path}) {
    res.push(path)
  })

  // make changes
  await archive.writeFile('/a.txt', 'one', 'utf8')
  await archive.writeFile('/b.txt', 'one', 'utf8')
  await archive.writeFile('/a.txt', 'one', 'utf8')
  await archive.writeFile('/a.txt', 'two', 'utf8')
  await archive.writeFile('/b.txt', 'two', 'utf8')
  await archive.writeFile('/c.txt', 'one', 'utf8')

  var n = 0
  while (res.length !== 6 && ++n < 10) {
    await sleep(500)
  }
  t.deepEqual(res, ['/a.txt', '/b.txt', '/a.txt', '/a.txt', '/b.txt', '/c.txt'])
})

test('archive.watch (array)', async t => {
  // create a fresh dat
  var archive = await DatArchive.create({title: 'Another Test Dat'})
  await archive._loadPromise

  // start the stream
  var res = []
  archive.watch(['/a.txt', '/c.txt'], function ({path}) {
    res.push(path)
  })

  // make changes
  await archive.writeFile('/a.txt', 'one', 'utf8')
  await archive.writeFile('/b.txt', 'one', 'utf8')
  await archive.writeFile('/a.txt', 'one', 'utf8')
  await archive.writeFile('/a.txt', 'two', 'utf8')
  await archive.writeFile('/b.txt', 'two', 'utf8')
  await archive.writeFile('/c.txt', 'one', 'utf8')

  var n = 0
  while (res.length !== 4 && ++n < 10) {
    await sleep(500)
  }
  t.deepEqual(res, ['/a.txt', '/a.txt', '/a.txt', '/c.txt'])
})

test('archive.createNetworkActivityStream', async t => {
  // share the test static dat
  var testStaticDat2 = await createDat()
  var testStaticDat2URL = 'dat://' + testStaticDat2.archive.key.toString('hex')
  var archive = new DatArchive(testStaticDat2URL)
  await archive._loadPromise

  // start the download & network stream
  var res = {
    metadata: {
      down: 0,
      all: false
    },
    content: {
      down: 0,
      all: false
    }
  }
  var events = archive.createNetworkActivityStream()
  events.addEventListener('network-changed', () => {
    res.gotPeer = true
  })
  events.addEventListener('download', ({feed}) => {
    res[feed].down++
  })
  events.addEventListener('sync', ({feed}) => {
    res[feed].all = true
  })

  // do writes
  await new Promise(resolve => {
    testStaticDat2.importFiles(__dirname + '/scaffold/test-static-dat', resolve)
  })

  // download
  await archive.download()

  var n = 0
  while (!res.content.all && ++n < 10) {
    await sleep(500)
  }
  t.truthy(res.metadata.down > 0)
  t.truthy(res.content.down > 0)
  t.deepEqual(res.metadata.all, true)
  t.deepEqual(res.content.all, true)
})

function sleep (time) {
  return new Promise(resolve => setTimeout(resolve, time))
}
