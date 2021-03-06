'use strict'

let https = require('https')
let got = require('got')
let url = require('url')
let config = require('../config')
let redis = require('./redis')

let cacheKey = name => `/packages/${name}`

function isEtagFresh (name, etag) {
  return redis.get(`${cacheKey(name)}/etag`)
  .then(cache => etag === cache)
  .catch(err => console.error(err.stack))
}

function updateEtag (name, etag) {
  redis.setex(`${cacheKey(name)}/etag`, config.cache.packageTTL, etag)
  .catch(err => console.error(err.stack))
}

function fetchFromCache (name) {
  return redis.get(cacheKey(name))
  .then(pkg => {
    if (pkg) {
      console.log(`${name} found in cache`)
      return JSON.parse(pkg)
    }
  })
  .catch(err => console.error(err.stack))
}

function updateCache (pkg) {
  if (!redis) return
  redis.setex(cacheKey(pkg.name), config.cache.packageTTL, JSON.stringify(pkg))
  .catch(err => console.error(err.stack))
}

function * get (name, etag) {
  try {
    if (etag && redis && (yield isEtagFresh(name, etag))) return 304
    let pkg = redis ? yield fetchFromCache(name) : null
    if (pkg) return pkg
    let opts = {timeout: config.timeout, headers: {}}
    if (etag) opts.headers['if-none-match'] = etag
    let res = yield got(url.resolve(config.uplink.href, '/' + name.replace(/\//, '%2F')), opts)
    pkg = JSON.parse(res.body)
    pkg.etag = res.headers.etag
    updateCache(pkg)
    return pkg
  } catch (err) {
    switch (err.statusCode) {
      case 304:
        if (redis) updateEtag(name, etag)
        return 304
      case 404:
        return 404
      default:
        console.error(`error downloading ${name}: ${err.stack}`)
        return 404
    }
  }
}

function getTarball (name, filename) {
  return new Promise(function (resolve, reject) {
    https.get(`${config.uplink.href}${name}/-/${filename}`, function (res) {
      if (res.statusCode === 404) return resolve()
      resolve(res)
    }).on('error', reject)
  })
}

module.exports = {
  get: get,
  getTarball
}
