// Force sentry DSN into environment variables
// In the future, will be set by the stack
process.env.SENTRY_DSN =
  process.env.SENTRY_DSN ||
  'https://1bdc9628c1724cb899ce99bb547efd19:6bd1ecd2e64e42558499c9b2a5d1a0e7@sentry.cozycloud.cc/17'

const moment = require('moment')
const {
  BaseKonnector,
  cozyClient,
  log,
  requestFactory,
  updateOrCreate
} = require('cozy-konnector-libs')

const apikey = 'eeafd0bd-a921-420e-91ce-3b52ee5807e8'
const infoUrl = `https://openapiweb.maif.fr/prod/cozy/v1/mes_infos?apikey=${apikey}`

const REQUEST_TIMEOUT_MS = 10000

let request = requestFactory({
  // debug: true,
})

module.exports = new BaseKonnector(function fetch(fields) {
  const fetch = isTokenExpired(fields.access_token)
    ? renewAndFetchData
    : fetchData

  return fetch
    .bind(this)(fields)
    .then(response => normalizeResponse.bind(this)(response))
    .then(entries => {
      return updateOrCreate(entries.contrats, 'fr.maif.maifuser.contrat', [
        'societaire'
      ])
        .then(() =>
          updateOrCreate(entries.homes, 'fr.maif.maifuser.home', ['name'])
        )
        .then(() =>
          updateOrCreate(entries.foyers, 'fr.maif.maifuser.foyer', ['name'])
        )
        .then(() =>
          updateOrCreate(
            entries.paymenttermss,
            'fr.maif.maifuser.paymentterms',
            ['societaire']
          )
        )
        .then(() =>
          updateOrCreate(entries.sinistres, 'fr.maif.maifuser.sinistre', [
            'timestamp'
          ])
        )
        .then(() =>
          updateOrCreate(entries.societaires, 'fr.maif.maifuser.societaire', [
            'email'
          ])
        )
    })
    .catch(err => {
      log('error', JSON.stringify(err))
      this.terminate('VENDOR_DOWN')
    })
})

// for tests
module.exports.renewToken = renewToken

function renewToken(requiredFields) {
  const accountId = JSON.parse(process.env.COZY_FIELDS).account
  return cozyClient
    .fetchJSON('POST', `/accounts/maif/${accountId}/refresh`)
    .then(body => {
      requiredFields.access_token = body.attributes.oauth.access_token
      // log('info', requiredFields.access_token, 'new access_token')
    })
}

function isTokenExpired(token) {
  var base64Url = token.split('.')[1]
  var base64 = base64Url.replace('-', '+').replace('_', '/')
  var decodedToken = JSON.parse(Buffer.from(base64, 'base64'))
  var decodedTimestamp = decodedToken.exp * 1000
  var timestamp = Date.now()

  if (decodedTimestamp > timestamp) {
    log('info', 'Token non expiré ... Fetching des Data')
    return false
  } else {
    log('info', 'Token expiré ... Renouvellement du token')
    return true
  }
}

/**
 * The API sends the Euro sign as the 128 character (80 in hex)
 * We convert it here
 */
function convert128ToEuro(s) {
  if (s && typeof s.replace === 'function') s = s.replace(/\u0080/, '€')
  return s
}

function cleanHomeData(homeData) {
  return Object.assign({}, homeData, {
    patrimoineMobilier: convert128ToEuro(homeData.patrimoineMobilier)
  })
}

function fetchData(fields) {
  log('info', 'fetchData')

  return request({
    url: infoUrl,
    headers: {
      Authorization: `Bearer ${fields.access_token}`
    },
    timeout: REQUEST_TIMEOUT_MS,
    resolveWithFullResponse: true
  })
}

function renewAndFetchData(fields) {
  return renewToken(fields).then(() => fetchData(fields))
}

function normalizeResponse(response) {
  moment.locale('fr')
  const body = response.body
  const entries = {}

  if (body && body['MesInfos']) {
    // Ajout data Contrat
    entries.contrats = []
    entries.contrats.push({ contrat: body['MesInfos'].contract })

    // Ajout data Home
    entries.homes = []
    if (
      body['MesInfos'].home &&
      typeof body['MesInfos'].home.map === 'function'
    ) {
      entries.homes.push({ home: body['MesInfos'].home.map(cleanHomeData) })
    } else {
      log('info', 'No Home data')
    }

    // Ajout data Foyer
    entries.foyers = []
    entries.foyers.push({ foyer: body['MesInfos'].foyer })

    // Ajout data ModalitesPaiement
    entries.paymenttermss = []
    entries.paymenttermss.push({ paymentterms: body['MesInfos'].paymentTerms })

    // Ajout data Sinistre
    let sinistres = body['MesInfos'].insuranceClaim
    sinistres = sortByDate(sinistres)
    entries.sinistres = []
    entries.sinistres.push({ sinistre: sinistres })

    // Ajout data Societaire
    entries.societaires = []
    entries.societaires.push({ societaire: body['MesInfos'].client })
  } else {
    log('warn', 'No data in the body returned by the MAIF api')
    return this.terminate('UNKNOWN_ERROR')
  }

  return entries
}

function sortByDate(data) {
  if (!data) return []

  data.sort(function(a, b) {
    a = new Date(a.horodatage).getTime()
    b = new Date(b.horodatage).getTime()
    return a > b ? -1 : a < b ? 1 : 0
  })
  return data
}
