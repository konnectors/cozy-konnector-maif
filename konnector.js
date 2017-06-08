/**
* MAIF Cozy's konnector
*/

'use strict'

const request = require('request')
// usefull for debugging the konnector
// require('request-debug')(request)
const moment = require('moment')
const uuid = require('uuid')
const {baseKonnector, cozyClient, log, updateOrCreate, models} = require('cozy-konnector-libs')
const imp = require('./maifuser')
const Contrat = imp.doctypeContrat
const Home = imp.doctypeHome
const Foyer = imp.doctypeFoyer
const ModalitesPaiement = imp.doctypeModalitesPaiement
const SinistreHabitation = imp.doctypeSinistreHabitation
const SinistreVehicule = imp.doctypeSinistreVehicule
const Societaire = imp.doctypeSocietaire

const connectUrl = 'https://connect.maif.fr/connect'
const apikey = 'eeafd0bd-a921-420e-91ce-3b52ee5807e8'
const infoUrl = `https://openapiweb.maif.fr/prod/cozy/v1/mes_infos?apikey=${apikey}`
const clientId = '2921ebd6-5599-4fa6-a533-0537fac62cfe'
const secret = 'Z_-AMVTppsgj_F9tRLXfwUm6Wdq8OOv5a4ydDYzvbhFjMcp8aM90D0sdNp2kdaEczeGH_qYZhhd9JIzWkoWdGw'

const domain = cozyClient.cozyURL

const scope = 'openid+profile+offline_access'
const type = 'code'
const b64Client = new Buffer(`${clientId}:${secret}`).toString('base64')

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
  customView: '<%t konnector customview maif %>',
  connectUrl: `${connectUrl}/authorize?response_type=${type}&client_id=${clientId}&scope=${scope}&state=${state}&nonce=${nonce}&redirect_uri=`,

  color: {
    hex: '#007858',
    css: '#007858'
  },

  fields: {
    code: {
      type: 'hidden' // To get the Auth code returned on the redirection.
    },
    redirectPath: {
      type: 'hidden'
    },
    refreshToken: {
      type: 'hidden' // refreshToken
    }
  },

  dataType: [
    'bill',
    'contact',
  ],

  models: [Contrat,Home,Foyer,ModalitesPaiement,SinistreHabitation,SinistreVehicule,Societaire],
  fetchOperations: [
    refreshToken,
    fetchData,
    updateOrCreate(logger, Contrat, ['societaire']),
    updateOrCreate(logger, Home, ['name']),
    updateOrCreate(logger, Foyer, ['name']),
    updateOrCreate(logger, ModalitesPaiement, ['societaire']),
    updateOrCreate(logger, SinistreHabitation, ['timestamp']),
    updateOrCreate(logger, SinistreVehicule, ['timestamp']),
    updateOrCreate(logger, Societaire, ['email'])
  ]
})

function refreshToken (requiredFields, entries, data, next) {
  log('info', 'refreshToken')

  if (requiredFields.refreshToken && requiredFields.refreshToken !== '') {
    // Get a new access_token using the refreshToken.
    fetchToken({
      grant_type: 'refresh_token',
      refresh_token: requiredFields.refreshToken
    }, requiredFields, data, next)
  } else if (requiredFields.code && requiredFields.code !== '') {
    // Obtain tokens with the auth code.
    buildCallbackUrl(requiredFields, (err, redirectUrl) => {
      if (err) { return next(err) }
      fetchToken({
        grant_type: 'authorization_code',
        code: requiredFields.code,
        state,
        nonce,
        redirect_uri: ''
      }, requiredFields, data, next)
    })
  } else {
    next('token not found') // Need to perform OpenIdConnect steps.
  }
}

function fetchToken (form, requiredFields, data, next) {
  log('info', 'fetchToken')

  request.post({
    url: `${connectUrl}/token`,
    json: true,
    headers: {
      Authorization: `Basic ${b64Client}`
    },
    form
  }, (err, response, body) => {
    if (response.statusCode !== 200 && response.statusCode !== '200') {
      log('error', `fetchToken error: ${response.statusCode} - ${response.statusMessage}`)
      err = 'token not found'
    }

    if (err) {
      return next(err)
    }

    if (!body.id_token || !body.refresh_token) {
      log('error', `no token in body: ${body}`)
      return next('token not found')
    }

    data.accessToken = body.id_token
    requiredFields.refreshToken = body.refresh_token

    next()
  })
}

function buildCallbackUrl (requiredFields, callback) {
  let url = null
  let error = null
  try {
    let path = requiredFields.redirectPath.split('?')[0]
    if (path[0] === '/') {
      path = path.slice(1)
    }
    url = `${domain}apps/konnectors/${path}`
  } catch (e) {
    log('error', e)
    error = 'internal error'
  }
  callback(error, url)
}

function fetchData (requiredFields, entries, data, next) {
  log('info', 'fetchData')

  request.get({
    url: infoUrl,
    json: true,
    headers: {
      Authorization: `Bearer ${data.accessToken}`
    }
  }, (err, response, body) => {
    if (response.statusCode !== 200 && response.statusCode !== '200') {
      log('error', `fetchToken error: ${response.statusCode} - ${response.statusMessage}`)
      err = 'request error'
    }

    if (err) {
      return next(err)
    }
    moment.locale('fr')

    // Il est nécessaire de mettre un s à l'objet maifuser ==> Voir fonction updateOrCreate (ajout d'un s au displayName.toLowerCase pour retrouver l'entrie)

    // Ajout data MaifUser
    // entries.maifusers = []
    // entries.maifusers.push({'maifuser':body})

    // Ajout data Contrat
    entries.contrats = []
    entries.contrats.push({'contrat':body["MesInfos"].contract})

    // Ajout data Home
    entries.homes = []
    entries.homes.push({'home':body["MesInfos"].home})

    // Ajout data Foyer
    entries.foyers = []
    entries.foyers.push({'foyer':body["MesInfos"].foyer})

    // Ajout data ModalitesPaiement
    entries.paymenttermss = []
    entries.paymenttermss.push({'paymentterms':body["MesInfos"].paymentTerms})

    // Ajout data SinistreHabitation & SinistreVehicule
    var sinistres = body["MesInfos"].insuranceClaim
    sinistres=sortByDate(sinistres)
    entries.sinistrevehicules = []
    entries.sinistrehabitations = []
    var sinistrevehicules = []
    var sinistrehabitations = []


    // Parcours des sinistres
    for(var i=0;i<sinistres.length; i++){
      // Si immatriculationVehicule ==> sinistre VAM
      if (sinistres[i]["immatriculationVehicule"] != undefined && sinistres[i]["immatriculationVehicule"] != ""){
        sinistrevehicules.push(sinistres[i])
      // Sinon ==> sinistre RAQVAM
      } else {
        sinistrehabitations.push(sinistres[i])
      }
    }

    entries.sinistrevehicules.push({'sinistrevehicules':sinistrevehicules})
    entries.sinistrehabitations.push({'sinistrehabitations':sinistrehabitations})

    // Ajout data Societaire
    entries.societaires = []
    entries.societaires.push({'societaire':body["MesInfos"].client})

    next()
  })
}

function 	sortByDate(data){
		data.sort(function(a, b) {
			a = new Date(a.horodatage).getTime();
			b = new Date(b.horodatage).getTime();
	      return a>b ? -1 : a<b ? 1 : 0;
	  });
		return data;
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
