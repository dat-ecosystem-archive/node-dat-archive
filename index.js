const path = require('path')
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
  constructor (url, {localPath} = {}) {
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
      Dat(localPath || ram, urlp ? {key: urlp.hostname, sparse: true, latest: false, temp} : {indexing: false, latest: false, temp}, async (err, dat) => {
        if (err) {
          return reject(err)
        }
        dat.joinNetwork()
        this.url = this.url || `dat://${dat.archive.key.toString('hex')}`
        this._archive = dat.archive
        this._checkout = (this._version) ? dat.archive.checkout(this._version) : dat.archive

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

  static async create ({localPath, title, description}) {
    var archive = new DatArchive(null, {localPath})
    await archive._loadPromise
    await pda.writeFile(archive._archive, '/dat.json', JSON.stringify({url: archive.url, title, description}))
    return archive
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
        metaSize: 0,
        stagingSize: 0,

        // manifest
        title: manifest.title,
        description: manifest.description
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

  createFileActivityStream (pathPattern) {
    return toEventTarget(pda.createFileActivityStream(this._archive, pathPattern))
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
