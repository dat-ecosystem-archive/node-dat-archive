const path = require('path')
const fs = require('fs')
const parseDatURL = require('parse-dat-url')
const pda = require('pauls-dat-api')
const concat = require('concat-stream')
const Dat = require('dat-node')
const ram = require('random-access-memory')
const {datDns, timer, toEventTarget} = require('./lib/util')
const {
  DAT_MANIFEST_FILENAME,
  DAT_VALID_PATH_REGEX,
  DEFAULT_DAT_API_TIMEOUT
} = require('./lib/const')
const {
  ArchiveNotWritableError,
  ProtectedFileNotWritableError,
  InvalidPathError
} = require('beaker-error-constants')

// exported api
// =

const to = (opts) =>
  (opts && typeof opts.timeout !== 'undefined')
    ? opts.timeout
    : DEFAULT_DAT_API_TIMEOUT

class DatArchive {
  constructor (url, {localPath, datOptions, netOptions} = {}) {

    // parse URL
    const urlp = url ? parseDatURL(url) : null
    this.url = urlp ? `dat://${urlp.hostname}` : null

    // load the archive
    this._archive = null
    this._checkout = null
    this._version = urlp && urlp.version ? +urlp.version : null
    this._localPath = localPath
    this._loadPromise = new Promise((resolve, reject) => {
      // TODO resolve DNS
      const temp = !localPath
      let options = urlp ? {key: urlp.hostname, sparse: true, temp} : {indexing: false, temp}
      if (datOptions) {
        Object.keys(datOptions).forEach((key) => {
          options[key] = datOptions[key]
        })
      }
      if (typeof options.latest === 'undefined') {
        options.latest = false
      }
      Dat(localPath || ram, options, async (err, dat) => {
        if (err) {
          return reject(err)
        }
        dat.joinNetwork(netOptions)
        this.url = this.url || `dat://${dat.archive.key.toString('hex')}`
        this._archive = dat.archive
        this._checkout = (this._version) ? dat.archive.checkout(this._version) : dat.archive
        this._close = async () => {
          await new Promise((resolve, reject) => {
            dat.close(err => {
              if (err) reject(err)
              else resolve()
            })
          })
        }

        // await initial metadata sync if not the owner
        if (!dat.archive.writable && !dat.archive.metadata.length) {
          // wait to receive a first update
          await new Promise((resolve, reject) => {
            dat.archive.metadata.update(err => {
              if (err) reject(err)
              else resolve()
            })
          })
        }

        resolve()
      })
    })
  }

  static async create ({localPath, datOptions, netOptions, title, description, type, author}) {
    // make sure the directory DNE or is empty
    if (localPath) {
      let st = await new Promise(resolve => fs.stat(localPath, (err, st) => resolve(st)))
      if (st) {
        if (!st.isDirectory()) {
          throw new Error('Cannot create Dat archive. (A file exists at the target location.)')
        }
        let listing = await new Promise(resolve => fs.readdir(localPath, (err, listing) => resolve(listing)))
        if (listing && listing.length > 0) {
          throw new Error('Cannot create Dat archive. (The target folder is not empty.)')
        }
      }
    }

    // create the dat
    var archive = new DatArchive(null, {localPath, datOptions, netOptions})
    await archive._loadPromise
    await pda.writeManifest(archive._archive, {url: archive.url, title, description, type, author})
    return archive
  }

  static async load ({localPath, datOptions, netOptions}) {
    if (!localPath) {
      throw new Error('Must provide {localPath}.')
    }

    // make sure the directory exists
    var st = await new Promise(resolve => fs.stat(localPath, (err, st) => resolve(st)))
    if (!st || !st.isDirectory()) {
      throw new Error('Cannot load Dat archive. (No folder exists at the given location.)')
    }

    // load the dat
    var archive = new DatArchive(null, {localPath, datOptions, netOptions})
    await archive._loadPromise
    return archive
  }

  async configure (settings) {
    await this._loadPromise
    if (!settings || typeof settings !== 'object') throw new Error('Invalid argument')
    const knownProps = [
      'author',
      'description',
      'fallback_page',
      'links',
      'title',
      'type',
      'web_root'
    ]
    if (knownProps.filter(prop => prop in settings).length > 0) {
      await pda.updateManifest(this._archive, settings)
    }
    if ('networked' in settings) {
      // TODO
    }
  }

  async getInfo (url, opts = {}) {
    return timer(to(opts), async () => {
      await this._loadPromise

      // read manifest
      var manifest
      try {
        manifest = await pda.readManifest(this._checkout)
      } catch (e) {
        manifest = {}
      }

      // return
      return {
        key: this._archive.key.toString('hex'),
        url: this.url,
        isOwner: this._archive.writable,

        // state
        version: this._checkout.version,
        peers: this._archive.metadata.peers.length,
        mtime: 0,
        size: 0,

        // manifest
        title: manifest.title,
        description: manifest.description,
        type: manifest.type,
        author: manifest.author,
        links: manifest.links
      }
    })
  }

  async diff () {
    // noop
    return []
  }

  async commit () {
    // noop
    return []
  }

  async revert () {
    // noop
    return []
  }

  async history (opts = {}) {
    return timer(to(opts), async () => {
      await this._loadPromise
      var reverse = opts.reverse === true
      var {start, end} = opts

      // if reversing the output, modify start/end
      start = start || 0
      end = end || this._checkout.metadata.length
      if (reverse) {
        // swap values
        let t = start
        start = end
        end = t
        // start from the end
        start = this._checkout.metadata.length - start
        end = this._checkout.metadata.length - end
      }

      return new Promise((resolve, reject) => {
        var stream = this._checkout.history({live: false, start, end})
        stream.pipe(concat({encoding: 'object'}, values => {
          values = values.map(massageHistoryObj)
          if (reverse) values.reverse()
          resolve(values)
        }))
        stream.on('error', reject)
      })
    })
  }

  async stat (filepath, opts = {}) {
    filepath = massageFilepath(filepath)
    return timer(to(opts), async () => {
      await this._loadPromise
      return pda.stat(this._checkout, filepath)
    })
  }

  async readFile (filepath, opts = {}) {
    filepath = massageFilepath(filepath)
    return timer(to(opts), async () => {
      await this._loadPromise
      return pda.readFile(this._checkout, filepath, opts)
    })
  }

  async writeFile (filepath, data, opts = {}) {
    filepath = massageFilepath(filepath)
    return timer(to(opts), async () => {
      await this._loadPromise
      if (this._version) throw new ArchiveNotWritableError('Cannot modify a historic version')
      await assertWritePermission(this._archive)
      await assertValidFilePath(filepath)
      await assertUnprotectedFilePath(filepath)
      return pda.writeFile(this._archive, filepath, data, opts)
    })
  }

  async unlink (filepath) {
    filepath = massageFilepath(filepath)
    return timer(to(), async () => {
      await this._loadPromise
      if (this._version) throw new ArchiveNotWritableError('Cannot modify a historic version')
      await assertWritePermission(this._archive)
      await assertUnprotectedFilePath(filepath)
      return pda.unlink(this._archive, filepath)
    })
  }

  async download (filepath, opts = {}) {
    filepath = massageFilepath(filepath)
    return timer(to(opts), async (checkin) => {
      await this._loadPromise
      if (this._version) throw new Error('Not yet supported: can\'t download() old versions yet. Sorry!') // TODO
      if (this._archive.writable) {
        return // no need to download
      }
      return pda.download(this._archive, filepath)
    })
  }

  async readdir (filepath, opts = {}) {
    filepath = massageFilepath(filepath)
    return timer(to(opts), async () => {
      await this._loadPromise
      var names = await pda.readdir(this._checkout, filepath, opts)
      if (opts.stat) {
        for (let i = 0; i < names.length; i++) {
          names[i] = {
            name: names[i],
            stat: await pda.stat(this._checkout, path.join(filepath, names[i]))
          }
        }
      }
      return names
    })
  }

  async mkdir (filepath) {
    filepath = massageFilepath(filepath)
    return timer(to(), async () => {
      await this._loadPromise
      if (this._version) throw new ArchiveNotWritableError('Cannot modify a historic version')
      await assertWritePermission(this._archive)
      await assertValidPath(filepath)
      await assertUnprotectedFilePath(filepath)
      return pda.mkdir(this._archive, filepath)
    })
  }

  async rmdir (filepath, opts = {}) {
    return timer(to(opts), async () => {
    filepath = massageFilepath(filepath)
      await this._loadPromise
      if (this._version) throw new ArchiveNotWritableError('Cannot modify a historic version')
      await assertUnprotectedFilePath(filepath)
      return pda.rmdir(this._archive, filepath, opts)
    })
  }

  watch (pathSpec = null, onInvalidated = null) {
    // usage: (onInvalidated)
    if (typeof pathSpec === 'function') {
      onInvalidated = pathSpec
      pathSpec = null
    }

    var evts = toEventTarget(pda.watch(this._archive, pathSpec))
    if (onInvalidated) {
      evts.addEventListener('invalidated', onInvalidated)
    }
    return evts
  }

  createFileActivityStream (pathPattern) {
    console.warn('node-dat-archive: The DatArchive createFileActivityStream() API has been deprecated, use watch() instead.')
    return this.watch(pathPattern)
  }

  createNetworkActivityStream () {
    return toEventTarget(pda.createNetworkActivityStream(this._archive))
  }

  static async resolveName (name) {
    return datDns.resolveName(name)
  }
}

module.exports = DatArchive

// internal helpers
// =

// helper to check if filepath refers to a file that userland is not allowed to edit directly
function assertUnprotectedFilePath (filepath) {
  if (filepath === '/' + DAT_MANIFEST_FILENAME) {
    throw new ProtectedFileNotWritableError()
  }
}

async function assertWritePermission (archive) {
  // ensure we have the archive's private key
  if (!archive.writable) {
    throw new ArchiveNotWritableError()
  }
  return true
}

async function assertValidFilePath (filepath) {
  if (filepath.slice(-1) === '/') {
    throw new InvalidPathError('Files can not have a trailing slash')
  }
  await assertValidPath(filepath)
}

async function assertValidPath (fileOrFolderPath) {
  if (!DAT_VALID_PATH_REGEX.test(fileOrFolderPath)) {
    throw new InvalidPathError('Path contains invalid characters')
  }
}

function massageHistoryObj ({name, version, type}) {
  return {path: name, version, type}
}

function massageFilepath (filepath) {
  filepath = filepath || ''
  filepath = decodeURIComponent(filepath)
  if (!filepath.startsWith('/')) {
    filepath = '/' + filepath
  }
  return filepath
}
