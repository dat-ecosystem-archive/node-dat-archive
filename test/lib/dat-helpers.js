const Dat = require('dat-node')
const tempy = require('tempy')

exports.shareDat = function (dir) {
  return new Promise((resolve, reject) => {
    Dat(dir, {temp: true}, function (err, dat) {
      if (err) return reject(err)
      dat.joinNetwork()
      dat.importFiles(dir, function (err) {
        if (err) return reject(err)
        resolve(dat)
      })
    })
  })
}

exports.createDat = function () {
  return new Promise((resolve, reject) => {
    Dat(tempy.directory(), {temp: true}, function (err, dat) {
      if (err) return reject(err)
      dat.joinNetwork()
      resolve(dat)
    })
  })
}