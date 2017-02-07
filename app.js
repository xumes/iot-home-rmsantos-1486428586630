/********************************************************* {COPYRIGHT-TOP} ***
* IBM Confidential
* OCO Source Materials
* IoT for Electronics - SVL720160500
*
* (C) Copyright IBM Corp. 2016  All Rights Reserved.
*
* The source code for this program is not published or otherwise  
* divested of its trade secrets, irrespective of what has been 
* deposited with the U.S. Copyright Office.
********************************************************* {COPYRIGHT-END} **/

VCAP_SERVICES = {};
if(process.env.VCAP_SERVICES)
	VCAP_SERVICES = JSON.parse(process.env.VCAP_SERVICES);

var iotf_host = VCAP_SERVICES["iotf-service"][0]["credentials"].http_host;

if(iotf_host.search('.staging.internetofthings.ibmcloud.com') > -1)
	process.env.STAGING = 1;

process.env.KEY = 'IoT for Electronics - Simulation Engine API key';

var express = require('express');
var cfenv = require('cfenv');
var log4js = require('log4js');
var async = require ('async');
var app = express();
var basicAuth = require('basic-auth');

//set the app object to export so it can be required
module.exports = app;

var path            = require('path'),
    favicon         = require('serve-favicon'),
    logger          = require('morgan'),
    cookieParser    = require('cookie-parser'),
    bodyParser      = require('body-parser'),
    cors            = require('cors'),
    routes          = require('./routes/index'),
    device          = require('./routes/device'),
    simulator       = require('./routes/simulator'),
    http            = require('http'),
    request         = require('request'),
    _               = require("underscore"),
    appEnv          = cfenv.getAppEnv(),
    q               = require('q'),
    helmet			= require('helmet');

var jsonParser = bodyParser.json();
var i18n = require("i18n");

i18n.configure({
    directory: __dirname + '/locales',
    defaultLocale: 'en',
    queryParameter: 'lang',
    objectNotation: true,
    fallbacks: {
      'pt'   : 'pt_BR',
      'pt-BR': 'pt_BR',
      'zh-CN': 'zh_CN',
      'zh-TW': 'zh_TW'
    },
    prefix: 'electronics-'
});

dumpError = function(msg, err) {
	if (typeof err === 'object') {
		msg = (msg) ? msg : "";
		var message = "***********ERROR: " + msg + " *************\n";
		if (err.message) {
			message += '\nMessage: ' + err.message;
		}
		if (err.stack) {
			message += '\nStacktrace:\n';
			message += '====================\n';
			message += err.stack;
			message += '====================\n';
		}
		console.error(message);
	} else {
		console.error('dumpError :: argument is not an object');
	}
};

//The IP address of the Cloud Foundry DEA (Droplet Execution Agent) that hosts this application:
var host = (process.env.VCAP_APP_HOST || 'localhost');

//Add a handler to inspect the req.secure flag (see
//http://expressjs.com/api#req.secure). This allows us
//to know whether the request was via http or https.
app.use(function (req, res, next) {
	res.set({
		'Cache-Control': 'no-store',
		'Pragma': 'no-cache'
	});
	//force https
	if(!appEnv.isLocal && req.headers['x-forwarded-proto'] && req.headers['x-forwarded-proto'] == 'http')
		res.redirect(308, 'https://' + req.headers.host + req.url);
	else
		next();
});

//allow cross domain calls
app.use(helmet());
app.use(cors());
app.use(logger('dev'));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(i18n.init);

app.use(function(req, res, next){
  if(req.query.mocked === 'true'){
    var locale = req.getLocale();
    req.setLocale('mocked_' + req.getLocale());
    if(req.getLocale() !== 'mocked_' + locale){
      req.setLocale(locale);
    }
    next();
  } else {
    next();
  }
});

app.use(express.static(path.join(__dirname, 'public')));

app.use('/', routes);
app.use('/', device);
app.use('/', simulator);

//Get credentials of related services.
//Get IoTP credentials
if(!VCAP_SERVICES || !VCAP_SERVICES["iotf-service"])
	throw "Cannot get IoT-Foundation credentials"
var iotfCredentials = VCAP_SERVICES["iotf-service"][0]["credentials"];

//Get IoT for Electronics credentials
if(!VCAP_SERVICES || !VCAP_SERVICES["ibm-iot-for-electronics"])
	throw "Cannot get IoT4E credentials"
var iotECredentials = VCAP_SERVICES["ibm-iot-for-electronics"][0]["credentials"];

//IoT Platform Credentials
var name = iotfCredentials["org"];
var orgId = iotfCredentials["org"];
var apiKey = iotfCredentials["apiKey"];
var authToken = iotfCredentials["apiToken"];
var baseURI = iotfCredentials["base_uri"];
var apiURI = 'https://' + iotfCredentials["http_host"] + ':443/api/v0002';
var iotpHttpHost = iotfCredentials["http_host"];

//IoT for Electronics Credentials
var iotETenant = iotECredentials["tenantID"];
var iotEAuthToken = iotECredentials["authToken"];
var iotEApiKey = iotECredentials["apiKey"];

/***************************************************************/
//STEPHANIES'S CODE *************
/***************************************************************/
/***************************************************************/

// SETUP CLOUDANT
var passport   = require('passport');
var MCABackendStrategy = require('bms-mca-token-validation-strategy').MCABackendStrategy;
var services = JSON.parse(process.env.VCAP_SERVICES)
var application = JSON.parse(process.env.VCAP_APPLICATION)
var currentOrgID = iotfCredentials["org"];

//SETUP Starter App Region
var regionURL = "https://registration-uss-iot4e.electronics.internetofthings.ibmcloud.com/";
if(application.application_uris[0].indexOf(".eu-gb.") > -1)
{
	regionURL = "https://iotforelectronicstile.eu-gb.mybluemix.net/";
}
	
	
/***************************************************************/
/* Set up express server & passport                            */
/***************************************************************/
passport.use(new MCABackendStrategy());
app.use(passport.initialize());

const https = require('https');
var authenticate = function(req,res,next)
{
		function unauthorized(res)
		{
			console.log('inside unauthorized function');
			res.set('WWW-Authenticate', 'Basic realm=Authorization Required');
			return res.status(401).end();
		};
		var user = basicAuth(req);
		if (!user || !user.name || !user.pass || user.name != iotEApiKey || user.pass != iotEAuthToken)
		{
			console.log('inside !user if block - unauthorized')
    		return unauthorized(res);
  		}
  		else
  		{
  			console.log("API validated.");
  	  		return next();
  		}
}


/***************************************************************/
/* Route to update 1 user document in Cloudant                 */
/*					        	       */
/* Input: url params that contains the userID 		       */
/* Returns:  404 for user not found, 200 for success           */
/***************************************************************/
app.put('/users', passport.authenticate('mca-backend-strategy', {session: false }), function(req, res)
{
	//var formData = req.body;
	var userDocIn = JSON.parse(JSON.stringify(req.body));
	userDocIn.orgID = currentOrgID;

	//verify that userID coming in MCA matches doc userID
	if (userDocIn.userID != req.user.id)
	{
		res.status(500).send("User ID in request does not match MCA authenticated user.")
		console.log("doc userID and mca userID do not match")
	}
	request({
   		url: (regionURL + 'v001/users'),//'https://registration-uss-iot4e.electronics.internetofthings.ibmcloud.com/v001/users',
		json: userDocIn,
		method: 'PUT',
		headers: {
    				'Content-Type': 'application/json',
    				'tenantID':iotETenant,
    				'orgID':currentOrgID
  		},
  		auth: {user:iotEApiKey, pass:iotEAuthToken}

    	}, function(error, response, body){
    		if(error) {
        		console.log('ERROR: ' + error);
			console.log('BODY: ' + error);
        		res.status(500).send(response);
    		} else {
        		console.log(response.statusCode, body);
        		res.status(200).send(response);
		}});
});

/********************************************************/
/* Admin. function specifically for adding a user doc   */
/* on mobile login, when one doesn't already exist      */
/* for the user logging in                              */
/********************************************************/
createUser = function (username)
{
	console.log("inside createUser function");
	//first see if the user exists
	var options =
	{
		url: (regionURL + 'v001/users/' + username),
		method: 'GET',
		headers: {
    				'Content-Type': 'application/json',
    				'tenantID':iotETenant,
    				'orgID':currentOrgID
  		},
  		auth: {user:iotEApiKey, pass:iotEAuthToken}
	};
	request(options, function (error, response, body) {
	    if (!error && response.statusCode == 200) {
	    	//we already have a user, so do nothing
        	console.log('User exists, wont create one.' + body);
        	return;
	    }else if (error){
        	console.log("The request came back with an error: " + error);
        	return;
        	}else{
        		//no user doc found, register this user
        		userDoc = {};
        		userDoc.orgID = currentOrgID;
        		userDoc.userID = username;
        		userDoc.userDetail = {};
			request({
   				url: (regionURL + 'v001/users'),
				json: userDoc,
				method: 'POST',
				headers: {
    						'Content-Type': 'application/json',
    						'tenantID':iotETenant,
    						'orgID':currentOrgID
  				},
  				auth: {user:iotEApiKey, pass:iotEAuthToken}

	    		}, function(error, response, body){
	    			if(error) {
	        			console.log('ERROR: ' + error);
					console.log('BODY: ' + error);
					return;
    				} else {
		        		console.log(response.statusCode, body);
		        		return;
				}
    		   	});
        	}
        });
}

/*******************************************/
/* Version 1 POST /users                   */
/*******************************************/
app.post('/v001/users', authenticate, function(req, res)
{
	var bodyIn = JSON.parse(JSON.stringify(req.body));
	delete bodyIn.version;
		request({
		url: (regionURL + 'v001/users'),
		json: bodyIn,
		method: 'POST',
		headers: {
    				'Content-Type': 'application/json',
    				'tenantID':iotETenant,
    				'orgID':currentOrgID
  		},
  		auth: {user:iotEApiKey, pass:iotEAuthToken}
		}, function(error, response, body){
			if(error) {
				console.log('ERROR: ' + error);
				console.log('BODY: ' + error);
				res.status(response.statusCode).send(response);
			} else {
				console.log(response.statusCode, body);
				res.status(response.statusCode).send(response);
			}
		});
});

/*******************************************/
/* Version 1 POST /appliances              */
/*******************************************/
app.post('/v001/appliances', authenticate, function (req, res)
{
	var bodyIn = JSON.parse(JSON.stringify(req.body));
	delete bodyIn.version;
	request({
		url: (regionURL + 'v001/appliances'),
		json: bodyIn,
		method: 'POST',
		headers: {
    				'Content-Type': 'application/json',
    				'tenantID':iotETenant,
    				'orgID':currentOrgID
  		},
  		auth: {user:iotEApiKey, pass:iotEAuthToken}
		}, function(error, response, body){
			if(error) {
				console.log('ERROR: ' + error);
				console.log('BODY: ' + error);
				res.status(response.statusCode).send(response);
			} else {
				console.log(response.statusCode, body);
				res.status(response.statusCode).send(response);
			}
		});
});

/*******************************************/
/* Version 1 GET /users/:userID            */
/*******************************************/
app.get('/v001/users/:userID', authenticate, function (req, res)
{
	var options =
	{
		url: (regionURL + 'v001/users/'+ req.params.userID),
		method: 'GET',
		headers: {
    				'Content-Type': 'application/json',
    				'tenantID':iotETenant,
    				'orgID':currentOrgID
  		},
  		auth: {user:iotEApiKey, pass:iotEAuthToken}
	};
	request(options, function (error, response, body) {
	    if (!error && response.statusCode == 200) {
        	// Print out the response body
        	console.log(body);
        	res.status(response.statusCode).send(response);
	    }else{
        	console.log("The request came back with an error: " + error);
        	//for now I'm giving this a 500 so that postman won't be left hanging.
        	res.status(response.statusCode).send(response);
        	return;
        	}

        	});
});

/*******************************************/
/* Version 1 GET /appliances/:userID       */
/*******************************************/
app.get('/v001/appliances/:userID', authenticate, function (req, res)
{
	var options =
	{
		url: (regionURL + 'v001/appliances/'+ req.params.userID),
		method: 'GET',
		headers: {
    				'Content-Type': 'application/json',
    				'tenantID':iotETenant,
    				'orgID':currentOrgID
  		},
  		auth: {user:iotEApiKey, pass:iotEAuthToken}
	};
	request(options, function (error, response, body) {
	    if (!error) {
        	// Print out the response body
        	console.log("body: " + body);
        	console.log("response: " + response);
        	res.status(response.statusCode).send(body);
	    }else{
        	console.log("The request came back with an error: " + error);
        	//for now I'm giving this a 500 so that postman won't be left hanging.
        	res.status(response.statusCode).send(response);
        	return;
        	}

        	});
});

/**************************************************/
/* Version 1 GET /appliances/:userID/:applianceID */
/* Takes "version" as a header, ex:               */
/*   "version":"v001"                             */
/**************************************************/
app.get('/v001/appliances/:userID/:applianceID', authenticate, function (req, res)
{
	var options =
	{
		url: (regionURL + 'v001/appliances/'+ req.params.userID + '/' + req.params.applianceID),
		method: 'GET',
		headers: {
    				'Content-Type': 'application/json',
    				'tenantID':iotETenant,
    				'orgID':currentOrgID
  		},
  		auth: {user:iotEApiKey, pass:iotEAuthToken}
	};
	request(options, function (error, response, body) {
	    if (!error) {
        	// Print out the response body
        	console.log(body);
        	res.status(response.statusCode).json(body);
	    }else{
        	console.log("The request came back with an error: " + error);
        	//for now I'm giving this a 500 so that postman won't be left hanging.
        	res.status(response.statusCode).send(response);
        	return;
        	}

        	});
});

/*****************************************************/
/* Version 1 DELETE /appliances/:userID/:applianceID */
/* Takes "version" as a header, ex:                  */
/*   "version":"v001"                                */
/*****************************************************/
app.del("/v001/appliances/:userID/:applianceID", authenticate, function (req, res)
{
		request({
		url: (regionURL + 'v001/appliances/'+ req.params.userID + '/' + req.params.applianceID),
		method: 'DELETE',
		headers: {
    				'Content-Type': 'application/json',
    				'tenantID':iotETenant,
    				'orgID':currentOrgID
  		},
  		auth: {user:iotEApiKey, pass:iotEAuthToken}
		}, function(error, response, body){
			if(error) {
				console.log('ERROR: ' + error);
				console.log('BODY: ' + error);
				res.status(response.statusCode).send(response);
			} else {
				console.log(response.statusCode, body);
				res.status(response.statusCode).send(response);
			}
		});
});

/*****************************************************/
/* Version 1 DELETE /appliances/:userID/:applianceID */
/* Takes "version" as a header, ex:                  */
/*   "version":"v001"                                */
/*****************************************************/
app.delete("/v001/user/:userID", authenticate, function (req, res)
{
	var options =
	{
		url: (regionURL + 'v001/user/'+ req.params.userID),
		method: 'DELETE',
		headers: {
    				'Content-Type': 'application/json',
    				'tenantID':iotETenant,
    				'orgID':currentOrgID
  		},
  		auth: {user:iotEApiKey, pass:iotEAuthToken}
	};
	request(options, function (error, response, body) {
	    if (!error) {
        	// Print out the response body
        	console.log(body);
        	res.status(response.statusCode).send(response);
	    }else{
        	console.log("The request came back with an error: " + error);
        	//for now I'm giving this a 500 so that postman won't be left hanging.
        	res.status(response.statusCode).send(response);
        	return;
        	}

        	});
});


/***************************************************************/
/* Route to get 1 user document from Cloudant (1)              */
/*					  		   	*/
/* Input: url params that contains the userID 			 */
/* Returns: 200 for found user, 404 for user not found         */
/***************************************************************/
app.get('/users/:userID', passport.authenticate('mca-backend-strategy', {session: false }), function(req, res)
{
	//make sure userID on params matches userID coming in thru MCA
	if (req.params.userID != req.user.id)
	{
		res.status(500).send("User ID on request does not match MCA authenticated user.")
	}
	var version;
	if (!req.get('version') || req.get('version') == null || req.get('version') == undefined)
	{
		version = 'v001'
	}
	else
	{
		version = req.get('version');
	}
	console.log('url: ' +  'https://'+ application.application_uris[0] + '/' + version + '/users/' + req.user.id);

	var options =
	{
		url: ('https://'+ application.application_uris[0] + '/' + version + '/users/' + req.user.id),
		method: 'GET',
  		auth: {user:iotEApiKey, pass:iotEAuthToken}
	};
	request(options, function (error, response, body) {
	    if (!error && response.statusCode == 200) {
        	// Print out the response body
        	console.log(body);
        	res.status(response.statusCode).send(response);
	    }else{
        	console.log("The request came back with an error: " + error);
        	//for now I'm giving this a 500 so that postman won't be left hanging.
        	res.status(response.statusCode).send(response);
        	return;
        	}
        });
});


/***************************************************************/
/* Route to add 1 user document to Cloudant.   (2)             */
/*                                                             */
/* Input: JSON structure that contains the userID, name,       */
/*             address, and telephone			       */
/***************************************************************/
// passport.authenticate('mca-backend-strategy', {session: false }),
app.post("/users", passport.authenticate('mca-backend-strategy', {session: false }),  function (req, res)
{
	//var formData = req.body;
	var formData = JSON.parse(JSON.stringify(req.body));
	formData.orgID = currentOrgID;

	//verify that userID coming in MCA matches doc userID
	if (formData.userID != req.user.id)
	{
		res.status(500).send("User ID in request does not match MCA authenticated user.")
		//might need a return here, needs test
		//see if logic ^ works first before finishing this
		console.log("doc userID and mca userID do not match")
	}
	//redirect
   	var version;
   	if (!formData.hasOwnProperty('version') || formData.version == null || formData.version == undefined)
   	{
   		version = "v001";
   	}
   	else
   	{
   		version = formData.version;
   	}
   	console.log('url: ' +  'https://'+ application.application_uris[0] + '/' + version + '/users');
	request({
   		url: 'https://'+ application.application_uris[0] + '/' + version + '/users',
		json: formData,
		method: 'POST',
  		auth: {user:iotEApiKey, pass:iotEAuthToken}

    	}, function(error, response, body){
    		if(error) {
        		console.log('ERROR: ' + error);
			console.log('BODY: ' + error);
        		res.status(response.statusCode).send(response);
    		} else {
        		console.log(response.statusCode, body);
        		res.status(response.statusCode).send(response);
		}});
});


/***************************************************************/
/* Route to add 1 appliance document to registration Cloudant.(3) */
/*                                                             */
/* Input: JSON structure that contains the userID, applianceID,*/
/*             serial number, manufacturer, and model          */
/***************************************************************/
app.post('/appliances', passport.authenticate('mca-backend-strategy', {session: false }), function (req, res)
{
	//grab the body to pass on
	var bodyIn = JSON.parse(JSON.stringify(req.body));
	//verify that userID coming in MCA matches doc userID
	if (bodyIn.userID != req.user.id)
	{
		res.status(500).send("User ID in request does not match MCA authenticated user.");
	}
   	bodyIn.userID = req.user.id;
   	bodyIn.orgID = currentOrgID;

   	//redirect
	var version;
	if (!req.get('version') || req.get('version') == null || req.get('version') == undefined)
	{
		version = 'v001'
	}
	else
	{
		version = req.get('version');
	}
   	console.log('url: ' +  'https://'+ application.application_uris[0] + '/' + version + '/appliances');
	request({
		url: 'https://'+ application.application_uris[0] + '/' + version + '/appliances',
		json: bodyIn,
		method: 'POST',
  		auth: {user:iotEApiKey, pass:iotEAuthToken}
		}, function(error, response, body){
			if(error) {
				console.log('ERROR: ' + error);
				console.log('BODY: ' + error);
				res.status(response.statusCode).send(response);
			} else {
				console.log(response.statusCode, body);
				res.status(response.statusCode).send(response);
			}
		});
});


/***************************************************************/
/* Route to show one user doc using Cloudant Query             */
/* Takes a userID in the url params                            */
/***************************************************************/
app.get('/user/:userID', passport.authenticate('mca-backend-strategy', {session: false }), function(req, res)
{
	//make sure userID on params matches userID coming in thru MCA
	if (req.params.userID != req.user.id)
	{
		res.status(500).send("User ID on request does not match MCA authenticated user.")
		//might need a return here, needs test
	}
	var version;
	if (!req.get('version') || req.get('version') == null || req.get('version') == undefined)
	{
		version = 'v001'
	}
	else
	{
		version = req.get('version');
	}
	console.log('url: ' +  'https://'+ application.application_uris[0] + '/' + version + '/user/' + req.user.id);

	var options =
	{
		url: ('https://'+ application.application_uris[0] + '/' + version + '/user/' + req.user.id),
		method: 'GET',
  		auth: {user:iotEApiKey, pass:iotEAuthToken}
	};
	request(options, function (error, response, body) {
	    if (!error) {
        	// Print out the response body
        	console.log(body);
        	res.status(response.statusCode).json(body);
	    }else{
        	console.log("The request came back with an error: " + error);
        	//for now I'm giving this a 500 so that postman won't be left hanging.
        	res.status(response.statusCode).send(response);
        	return;
        	}

        	});
});


/***************************************************************/
/* Route to list all appliance documents for given user   (4)  */
/*       													   */
/* Input: Query string with userID and optional applianceID    */
/***************************************************************/
app.get('/appliances/:userID', passport.authenticate('mca-backend-strategy', {session: false }), function (req, res)
{
	//make sure userID on params matches userID coming in thru MCA
	if (req.params.userID != req.user.id)
	{
		res.status(500).send("User ID on request does not match MCA authenticated user.");
		//might need a return here, needs test
	}
	var version;
	if (!req.get('version') || req.get('version') == null || req.get('version') == undefined)
	{
		version = 'v001'
	}
	else
	{
		version = req.get('version');
	}
	console.log('url: ' +  'https://'+ application.application_uris[0] + '/' + version + '/appliances/' + req.user.id);

	var options =
	{
		url: ('https://'+ application.application_uris[0] + '/' + version + '/appliances/' + req.user.id),
		method: 'GET',
  		auth: {user:iotEApiKey, pass:iotEAuthToken}
	};
	request(options, function (error, response, body) {
	    if (!error) {
        	// Print out the response body
        	console.log("body: " + body);
        	console.log("response: " + response);
        	res.status(response.statusCode).send(body);
	    }else{
        	console.log("The request came back with an error: " + error);
        	//for now I'm giving this a 500 so that postman won't be left hanging.
        	res.status(response.statusCode).send(response);
        	return;
        	}

        	});
});


/****************************************************************************/
/* Route to list 1 appliance document for given userID and applianceID (4)  */
/*       													   				*/
/* Input: Query string with userID and optional applianceID    				*/
/****************************************************************************/
app.get("/appliances/:userID/:applianceID", passport.authenticate('mca-backend-strategy', {session: false }), function (req, res)
{
	//make sure userID on params matches userID coming in thru MCA
	if (req.params.userID != req.user.id)
	{
		res.status(500).send("User ID on request does not match MCA authenticated user.")
		//might need a return here, needs test
	}
	var version;
	if (!req.get('version') || req.get('version') == null || req.get('version') == undefined)
	{
		version = 'v001'
	}
	else
	{
		version = req.get('version');
	}
	console.log('url: ' +  'https://'+ application.application_uris[0] + '/' + version + '/appliances/' + req.user.id + '/' + req.params.applianceID);
	var options =
	{
		url: ('https://'+ application.application_uris[0] + '/' + version + '/appliances/' + req.user.id + '/' + req.params.applianceID),
		method: 'GET',
  		auth: {user:iotEApiKey, pass:iotEAuthToken}
	};
	request(options, function (error, response, body) {
	    if (!error) {
        	// Print out the response body
        	console.log(body);
        	res.status(response.statusCode).json(body);
	    }else{
        	console.log("The request came back with an error: " + error);
        	//for now I'm giving this a 500 so that postman won't be left hanging.
        	res.status(response.statusCode).send(response);
        	return;
        	}
    });
});


/***************************************************************/
/* Route to delete appliance records                           */
/*    Internal API					       */
/***************************************************************/
app.del("/appliances/:userID/:applianceID", passport.authenticate('mca-backend-strategy', {session: false }), function (req, res)
{

	//verify that userID coming in MCA matches doc userID
	if (req.params.userID != req.user.id)
	{
		res.status(500).send("User ID in request does not match MCA authenticated user.")
		//might need a return here, needs test
	}
	var version;
	if (!req.get('version') || req.get('version') == null || req.get('version') == undefined)
	{
		version = 'v001'
	}
	else
	{
		version = req.get('version');
	}
	console.log('url: ' +  'https://'+ application.application_uris[0] + '/' + version + '/appliances/' + req.user.id + '/' + req.params.applianceID);
	request({
		url: ('https://'+ application.application_uris[0] + '/' + version + '/appliances/' + req.user.id + '/' + req.params.applianceID),
		method: 'DELETE',
  		auth: {user:iotEApiKey, pass:iotEAuthToken}
		}, function(error, response, body){
			if(error) {
				console.log('ERROR: ' + error);
				console.log('BODY: ' + error);
				res.status(response.statusCode).send(response);
			} else {
				console.log(response.statusCode, body);
				res.status(response.statusCode).send(response);
			}
		});
});



/**************************************************************************************** **/
/* Route to delete user documents.                              						   */
/* Need to delete the appliance documents as well from our db  							   */
/* If we created them on the platform, delete from platform (NOT for experimental)         */
/*******************************************************************************************/
app.delete("/user/:userID", passport.authenticate('mca-backend-strategy', {session: false }), function (req, res)
{
	//make sure userID on params matches userID coming in thru MCA
	if (req.params.userID != req.user.id)
	{
		res.status(500).send("User ID on request does not match MCA authenticated user.")
		//might need a return here, needs test
	}
	var version;
	if (!req.get('version') || req.get('version') == null || req.get('version') == undefined)
	{
		version = 'v001'
	}
	else
	{
		version = req.get('version');
	}
	console.log('url: ' +  'https://'+ application.application_uris[0] + '/' + version + '/user/' + req.user.id);
	var options =
	{
		url: ('https://'+ application.application_uris[0] + '/' + version + '/user/' + req.user.id),
		method: 'DELETE',
  		auth: {user:iotEApiKey, pass:iotEAuthToken}
	};
	request(options, function (error, response, body) {
	    if (!error) {
        	// Print out the response body
        	console.log(body);
        	res.status(response.statusCode).send(response);
	    }else{
        	console.log("The request came back with an error: " + error);
        	//for now I'm giving this a 500 so that postman won't be left hanging.
        	res.status(response.statusCode).send(response);
        	return;
        	}

        	});
});


//get IoT-Foundation credentials

/********************************************************************** **/
/*End of Registration Integrator Code                                               */
/********************************************************************** **/

/*
 * CONRAD'S CODE
 */

//Using hardcoded user repository
var userRepository = {
    "conrad":      { password: "12345" , displayName:"Conrad Kao"      , dob:"October 9, 1940"},
    "john.lennon":      { password: "12345" , displayName:"John Lennon"      , dob:"October 9, 1940"},
    "paul.mccartney":   { password: "67890" , displayName:"Paul McCartney"   , dob:"June 18, 1942"},
    "ringo.starr":      { password: "abcde" , displayName:"Ringo Starr"      , dob: "July 7, 1940"},
    "george.harrison":  { password: "fghij" , displayName: "George Harrison" , dob:"Feburary 25, 1943"}
};

var logger = log4js.getLogger("CustomIdentityProviderApp");
logger.info("Starting up");

app.post('/apps/:tenantId/:realmName/startAuthorization', jsonParser, function(req, res){
    var tenantId = req.params.tenantId;
    var realmName = req.params.realmName;
    var headers = req.body.headers;

    logger.debug("startAuthorization", tenantId, realmName, headers);

    var responseJson = {
        status: "challenge",
        challenge: {
            text: "Enter username and password"
        }
    };

    res.status(200).json(responseJson);
});

app.post('/apps/:tenantId/:realmName/handleChallengeAnswer', jsonParser, function(req, res){
    var tenantId = req.params.tenantId;
    var realmName = req.params.realmName;
    var challengeAnswer = req.body.challengeAnswer;

    logger.debug("handleChallengeAnswer", tenantId, realmName, challengeAnswer);

    var username = req.body.challengeAnswer["username"].replace(/\s+/g, '');
    var password = req.body.challengeAnswer["password"];

    var responseJson = { status: "failure" };

    //add the following lines to add a new user (temporily) when the username is not existed.
    if (userRepository[username] == null) {
        userRepository[username]={password: password, displayName: username, dob:"December 31, 2016"};
    }
	//create a user doc in registration for this user if one doesn't already exist
        createUser(username);
    var userObject = userRepository[username];

    if (userObject && userObject.password == password ){
        logger.debug("Login success for userId ::", username);
        responseJson.status = "success";
        responseJson.userIdentity = {
            userName: username,
            displayName: userObject.displayName,
            attributes: {
                dob: userObject.dob
            }
        };

    	} else {
	        logger.debug("Login failure for userId ::", username);
    	}

    	res.status(200).json(responseJson);
});


/********************************************************************** **/
/*Solution Integrator Code                                               */
/********************************************************************** **/
  //Get RTI credentials
// if(!VCAP_SERVICES || !VCAP_SERVICES["IoT Real-Time Insight"])
//  	throw "Cannot get RTI credentials"
// var rtiCredentials = VCAP_SERVICES["IoT Real-Time Insight"][0]["credentials"];

//RTI Credentials
//  var rtiApiKey = rtiCredentials["apiKey"];
//  var rtiAuthToken = rtiCredentials["authToken"];
//  var rtiBaseUrl = rtiCredentials["baseUrl"];
//  var disabled = false;

//Stephanie's deletedDoc Doc creation for Metering
//And storing credentials
console.log('Creating doc to track deleted docs');
//console.log('Deleted Docs API URL:', urlDel);
console.log('About to store credentials into Cloudant.');
var body = {
		"orgID":currentOrgID,
		"apiKey":apiKey,
		"authToken":authToken,
		"httpHost":iotpHttpHost,
		"iotEApiKey":iotEApiKey
	   };
var options =
	{
		//url: ('https://registration-uss-iot4e.electronics.internetofthings.ibmcloud.com/deletedDocs'),
		url: (regionURL + 'deletedDocs'),
		json: body,
		method: 'POST',
		headers: {
    				'Content-Type': 'application/json'
  		}
	};

function retryRequest(body, options)
{
	request(options, function (error, response, body) {
		if (!error) {
   			// Print out the response body
   			console.log('***Response Status Code --->', response.statusCode);
			console.log('***Response received: ' + response.message);
			if (response.statusCode === 404)
			{
				retryRequest();
			}
	    		}else{
       			console.log("The request came back with an error: " + error);
				console.log("Error code: " + error.statusCode);
				console.log("Error message: " + error.message);
        			return;
      			}
	});
};
console.log('Body Values being sent in: ' + JSON.parse(JSON.stringify(body)));
request(options, function (error, response, body) {
    if (!error) {
       	// Print out the response body
       	console.log('***Response Status Code --->', response.statusCode);
	console.log('***Response received: ' + response.message);
	if (response.statusCode === 404)
	{
		retryRequest();
        }else{
        	console.log("The request came back with an error: " + error);
			console.log("Error code: " + error.statusCode);
			console.log("Error message: " + error.message);
        	return;
        }
}
});

/*console.log('About to store IoTP Credentials');
var url = ['https://registration-uss-iot4e.electronics.internetofthings.ibmcloud.com/credentials', currentOrgID, apiKey, authToken, iotpHttpHost, iotEAuthToken,iotEApiKey].join('/');
console.log('Credentials API URL:', url);
request
  .get(url, {timeout: 000})
  .on('response', function(response){
  	console.log('Response Status Code --->', response.statusCode);
  	console.log('Response Message --->', response.message);
    console.log('Response received.');
  })
  .on('error', function(error){
    if(error.code === 'ETIMEDOUT')
      console.log('Request timed out.');
    else
      console.log('Error happened in Store IoTP credentials call --->',error);
  });
*/
/***************************************************************/
/* Route to show one user doc using Cloudant Query             */
/* Takes a userID in the url params                            */
/***************************************************************/
app.get('/validation', function(req, res)
{
	var options =
	{
		//url: 'https://registration-uss-iot4e.electronics.internetofthings.ibmcloud.com/validation/' + iotETenant + '/' +  iotEAuthToken + '/' + iotEApiKey,
		url: (regionURL + 'validation/' + iotETenant + '/' +  iotEAuthToken + '/' + iotEApiKey),
		auth: iotEAuthToken + ':' + iotEApiKey,
		method: 'GET',
		headers: {
    				'Content-Type': 'application/json'
  		}
	};
	request(options, function (error, response, body) {
	    if (!error && response.statusCode == 200) {
        	// Print out the response body
        	console.log(body);
        	//response.status(200).send("Successful test GET")
	    }else{
        	console.log(error);
        	//response.status(error.statusCode).send("ERROR on test GET")
        	}

        	});
});

/***************************************************************/
/* Route to send the IoTP credentials to the tile again        */
/* 									                           */
/***************************************************************/
/*app.get('*', function(req, res)
{
	console.log('About to store IoTP Credentials');
    var url = ['https://registration-uss-iot4e.electronics.internetofthings.ibmcloud.com/credentials', currentOrgID, apiKey, authToken, iotpHttpHost, iotEAuthToken,iotEApiKey].join('/');
	console.log('Credentials API URL:', url);
	request
  	.get(url, {timeout: 3000})
  	.on('response', function(response){
  		console.log('***Response received: ' + response.message);
    	console.log('Response received.');
  	})
  	.on('error', function(error){
    	if(error.code === 'ETIMEDOUT')
      		console.log('Request timed out.');
    	else
      		console.log(error);
  	});
});*/

// //var iotePass = ioteCredentials["password"];

// //IoT Platform Device Types
// //var	iotpDevId = "washingMachine";
// //var	iotpDescription = "IoT4E Washing Machine";
// //var	iotpClassId = "Device"

// //RTI Message Schema Info
// //var	rtiSchemaName = "Electronics";

// //IoT Platform Config Creation Method.
  var iotpPost = function iotpPost (path, json) {
  console.log('calling api to POST: ' + baseURI);
  console.log('IoTP API URI: ' + apiURI);
  console.log('calling api on json: ' + JSON.stringify(json));

    var url = apiURI + path;
    var defer = q.defer();
    var body = '';

    request
     .post({
        url: url,
        json: true,
        body: json
      }).auth(apiKey, authToken, true)
      .on('data', function(data) {
        body += data;
      })
      .on('end', function() {
        var json = JSON.parse(body);
        defer.resolve(json);
     })
     .on('response', function(response) {
        console.log('IoTP status: ' + response.statusCode);
    });
     return defer.promise;
  };

 // //RTI Config Creation Method.
  var rtiPost = function rtiPost (path, json) {
    console.log('calling api to baseURL: ' + rtiBaseUrl);
    console.log('calling api to Path ' + path);
    console.log('Rti Api: ' + rtiApiKey);
    console.log('Rti Token: ' + rtiAuthToken);
    console.log('calling api on json: ' + JSON.stringify(json));

    var url = rtiBaseUrl + path;
    var defer = q.defer();
    var body = '';

    request
     .post({
        url: url,
        json: true,
        body: json
      }).auth(rtiApiKey, rtiAuthToken, true)
     .on('data', function(data) {
        body += data;
      })
      .on('end', function() {
        var json = JSON.parse(body);
        defer.resolve(json);
     })
     .on('response', function(response) {
        console.log('`RTI status: ' + response.statusCode); // 200
    });
     return defer.promise;
   };

//IoT Platform device type creation call
// var iotpDeviceType = iotpPost('/device/types',{
// 	"id": "washingMachine",
// 	"description": "IoT4E Washing Machine",
//	"classId": "Device"
// });

// //IoT Platform device creation call
// //var iotpDeviceType = iotpPost('/device/types/washingMachine/devices',{
// //  //"id": "d:abc123:myType:myDevice",
// //  "typeId": "washingMachine",
// //  "deviceId": "washingMachineElec"
// //});

//RTI data source creation call
/*var rtiSource = rtiPost('/message/source',{
	"name": name,
	"orgId": orgId,
	"apiKey": apiKey,
	"authToken": authToken,
	"disabled": disabled})
		.then(function(json) {
			console.log('RTI Source Return: ' + JSON.stringify(json));
			var sourceValues = JSON.parse(JSON.stringify(json));
			console.log('RTI Source ID: ' + sourceValues.id);
			//RTI schema creation call
			  var rtiSchema = rtiPost('/message/schema',{
			  	"name": "Electronics",
			  	"format": "JSON",
			  	"items": []})
			  .then(function(json){
			  	console.log('RTI Schema Return: ' + JSON.stringify(json));
			  	var schemaValues = JSON.parse(JSON.stringify(json));
				//RTI route creation call
				  var rtiRoute = rtiPost('/message/route',{
				  	"sourceId": sourceValues.id,
				  	"deviceType": "washingMachine",
				  	"eventType": "+",
				  	"schemaId": schemaValues.id});
			  });
});*/


console.log('IoT4E Credentials: ' + iotETenant);
console.log('Application URL: ' + application.application_uris[0]);
console.log('Application Region URL: ' + regionURL);
/********************************************************************** **/
/*End of Solution Integrator Code                                        */
/********************************************************************** **/


//global IoT-Foundation connectors
washingMachineIoTFClient = require('./mqtt/washingMachineIoTFClient');
washingMachineIoTFClient.connectToBroker(iotfCredentials);

//var app = express();

//Enable reverse proxy support in Express. This causes the
//the "X-Forwarded-Proto" header field to be trusted so its
//value can be used to determine the protocol. See
//http://expressjs.com/api#app-settings for more details.
app.enable('trust proxy');

var server = require('http').Server(app);
iotAppMonitor = require('./lib/iotAppMonitorServer')(server);

//view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');
//uncomment after placing your favicon in /public
//app.use(favicon(__dirname + '/public/favicon.ico'));

//catch 404 and forward to error handler
app.use(function(req, res, next) {
	var err = new Error('Not Found');
	err.status = 404;
	next(err);
});

//error handlers

//development error handler
//will print stacktrace
if (app.get('env') === 'development') {
	app.use(function(err, req, res, next) {
		res.status(err.status || 500);
		res.render('error', {
			message: err.message,
			error: err
		});
	});
}

//production error handler
//no stacktraces leaked to user
app.use(function(err, req, res, next) {
	res.status(err.status || 500);
	res.render('error', {
		message: err.message,
		error: {}
	});
});

var port = normalizePort(appEnv.port || '3000');
app.set('port', port);

//require user extensions
try {
		require("./_app.js");
	} catch (e) {
		console.log("Failed to load extention file _app.js: " + e.message);
	};

//Start server
server.listen(app.get('port'), function() {
	console.log('Server listening on port ' + server.address().port);
});
server.on('error', onError);

//set the server in the app object
app.server = server;

/**
 * Normalize a port into a number, string, or false.
 */

function normalizePort(val) {
	var port = parseInt(val, 10);

	if (isNaN(port)) {
		// named pipe
		return val;
	}

	if (port >= 0) {
		// port number
		return port;
	}

	return false;
}

/**
 * Event listener for HTTP server "error" event.
 */

function onError(error) {
	if (error.syscall !== 'listen') {
		throw error;
	}

	var bind = typeof port === 'string'
		? 'Pipe ' + port
				: 'Port ' + port;

	// handle specific listen errors with friendly messages
	switch (error.code) {
	case 'EACCES':
		console.error(bind + ' requires elevated privileges');
		process.exit(1);
		break;
	case 'EADDRINUSE':
		console.error(bind + ' is already in use');
		process.exit(1);
		break;
	default:
		throw error;
	}
}

// app.use(function(req, res, next){
//     res.status(404).send("This is not the URL you're looking for");
// });
