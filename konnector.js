/**
* MAIF Cozy's konnector
*/

'use strict'

const async = require('async')
const request = require('request')
// usefull for debugging the konnector
// require('request-debug')(request)
const moment = require('moment')
const uuid = require('uuid')
const {baseKonnector, cozyClient, log, updateOrCreate} = require('cozy-konnector-libs')
const imp = require('./maifuser')
const Contrat = imp.doctypeContrat
const Home = imp.doctypeHome
const Foyer = imp.doctypeFoyer
const ModalitesPaiement = imp.doctypeModalitesPaiement
const Sinistre = imp.doctypeSinistre
const Societaire = imp.doctypeSocietaire

const apikey = 'eeafd0bd-a921-420e-91ce-3b52ee5807e8'
const infoUrl = `https://openapiweb.maif.fr/prod/cozy/v1/mes_infos?apikey=${apikey}`

const REQUEST_TIMEOUT_MS = 5000

const logger = require('printit')({
  prefix: 'Maif',
  date: true
})

let state = ''
let nonce = ''

if (state === '') {
  state = uuid()
}

if (nonce === '') {
  nonce = uuid()
}

module.exports = baseKonnector.createNew({
  name: 'MAIF',
  models: [Contrat, Home, Foyer, ModalitesPaiement, Sinistre, Societaire],
  fetchOperations: [
    tryntimes,
    updateOrCreate(logger, Contrat, ['societaire']),
    updateOrCreate(logger, Home, ['name']),
    updateOrCreate(logger, Foyer, ['name']),
    updateOrCreate(logger, ModalitesPaiement, ['societaire']),
    updateOrCreate(logger, Sinistre, ['timestamp']),
    updateOrCreate(logger, Societaire, ['email'])
  ]
})

function renewToken (requiredFields) {
  return cozyClient.fetchJSON('POST', `/accounts/maif/${module.exports.account_id}/refresh`)
  .then(body => {
    requiredFields.access_token = body.attributes.oauth.access_token
    // log('info', requiredFields.access_token, 'new access_token')
  })
}

function tryntimes (requiredFields, entries, data, next) {
  let count = 0
  async.whilst(function () {
    count++
    return Object.keys(entries).length === 0
  }, function (callback) {
    log('info', `Try ${count}`)
    fetchData(requiredFields, entries, data, callback)
  }, function (err, result) {
    if (err) log('error', err.message || err)
    next()
  })
}

/**
 * The API sends the Euro sign as the 128 character (80 in hex)
 * We convert it here
 */
function convert128ToEuro (s) {
  if (s && typeof s.replace === 'function') s = s.replace(/\u0080/, '€')
  return s
}

function cleanHomeData (homeData) {
  return Object.assign({}, homeData, {
    patrimoineMobilier: convert128ToEuro(homeData.patrimoineMobilier)
  })
}

function fetchData (requiredFields, entries, data, next) {
  log('info', 'fetchData')

  request.get({
    url: infoUrl,
    json: true,
    headers: {
      Authorization: `Bearer ${requiredFields.access_token}`
    },
    timeout: REQUEST_TIMEOUT_MS
  }, (err, response, body) => {
    if (response && Number(response.statusCode) === 401) {
      log('info', 'Access token expired. Renewing it')
      renewToken(requiredFields)
      .then(() => {
        log('info', 'Token renewal success')
        next()
      })
      .catch(err => {
        log('debug', err.message)
        log('info', 'Failed to renew the access token')
        next('LOGIN_FAILED')
      })
    } else if (response && response.statusCode !== 200 && response.statusCode !== '200') {
      let messageType = 'error'

      // Do not fail the konnector for 500 and 503 and prefer a retry
      if (response.statusCode === 500 || response.statusCode === 503) messageType = 'warning'

      log(messageType, `fetchData error: ${response.statusCode} - ${response.statusMessage}`)

      next('request error')
    } else {
      moment.locale('fr')

      // Il est nécessaire de mettre un s à l'objet maifuser ==> Voir fonction updateOrCreate (ajout d'un s au displayName.toLowerCase pour retrouver l'entrie)

      // Ajout data MaifUser
      // entries.maifusers = []
      // entries.maifusers.push({'maifuser':body})

      // Ajout data Contrat
      entries.contrats = []
      entries.contrats.push({'contrat': body['MesInfos'].contract})

      // Ajout data Home
      entries.homes = []
      entries.homes.push({'home': body['MesInfos'].home.map(cleanHomeData)})

      // Ajout data Foyer
      entries.foyers = []
      entries.foyers.push({'foyer': body['MesInfos'].foyer})

      // Ajout data ModalitesPaiement
      entries.paymenttermss = []
      entries.paymenttermss.push({'paymentterms': body['MesInfos'].paymentTerms})

      // Ajout data Sinistre
      let sinistres = body['MesInfos'].insuranceClaim
      sinistres = sortByDate(sinistres)
      entries.sinistres = []
      entries.sinistres.push({'sinistre': sinistres})

      // Ajout data Societaire
      entries.societaires = []
      entries.societaires.push({'societaire': body['MesInfos'].client})

      next()
    }
  })
}

function sortByDate (data) {
  if (!data) return []

  data.sort(function (a, b) {
    a = new Date(a.horodatage).getTime()
    b = new Date(b.horodatage).getTime()
    return a > b ? -1 : a < b ? 1 : 0
  })
  return data
}

/*
function createOrUpdateInDB (requiredFields, entries, data, next) {
  log('info', 'createOrUpdateInDB')

  updateOrCreate(entries.maifusers[0], (err) => {
    if (err) {
      log('error', err)
      return next('internal error')
    }

    next()
  })
}
*/
