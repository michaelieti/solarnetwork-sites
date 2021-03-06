/**
 * @require d3 3.0
 * @require CryptoJS 3.0 (HMAC-SHA1, MD5, BASE64)
 */
(function() {
'use strict';

if ( sn.sec === undefined ) {
	/**
	 * @namespace the SolarNetwork security namespace.
	 */
	sn.sec = {
		version : '1.1.0'
	};
}

// our in-memory credentials
var cred = {token: undefined, secret: undefined};

/**
 * Return <em>true</em> if both a token and a secret have been set, <em>false</em> otherwise.
 *
 * @return {Boolean} <em>true</em> if a token and secret have been set.
 */
sn.sec.hasTokenCredentials = function() {
	return (cred.token && cred.token.length > 0 && cred.secret && cred.secret.length > 0);
};

/**
 * Get or set the in-memory security token to use.
 *
 * @param {String} [value] The value to set, or <code>null</code> to clear.
 * @returs When used as a getter, the current token value, otherwise the {@link sn.sec} object.
 */
sn.sec.token = function(value) {
	if ( !arguments.length ) return cred.token;
	cred.token = (value && value.length > 0 ? value : undefined);
	return sn.sec;
};

/**
 * Set the in-memory security token secret to use.
 *
 * @param {String} [value] The value to set.
 * @returns The {@link sn.sec} object.
 */
sn.sec.secret = function(value) {
	if ( arguments.length ) {
		cred.secret = value;
	}
	return sn.sec;
};

/**
 * Return <em>true</em> if a secret has been set, <em>false</em> otherwise.
 *
 * @return {Boolean} <em>true</em> if a secret has been set.
 */
sn.sec.hasSecret = function() {
	return (cred.secret && cred.secret.length > 0);
};

/**
 * Clear the in-memory secret.
 * 
 * @returns The {@link sn.sec} object.
 */
sn.sec.clearSecret = function() {
	cred.secret = undefined;
	return sn.sec;
};

/**
 * Test if a Content-MD5 hash should be included in the request, based on the 
 * request content type.
 *
 * @param {String} contentType the content type
 * @returns {Boolean} <em>true</em> if including the Content-MD5 hash is appropriate
 */
function shouldIncludeContentMD5(contentType) {
	// we don't send Content-MD5 for form data, because server treats this as URL parameters
	return (contentType !== null && contentType.indexOf('application/x-www-form-urlencoded') < 0);
};

/**
 * Generate the authorization header value for a set of request parameters.
 * 
 * <p>This returns just the authorization header value, without the scheme. For 
 * example this might return a value like 
 * <code>a09sjds09wu9wjsd9uya:6U2NcYHz8jaYhPd5Xr07KmfZbnw=</code>. To use
 * as a valid <code>Authorization</code> header, you must still prefix the
 * returned value with <code>SolarNetworkWS</code> (with a space between
 * that prefix and the associated value).</p>
 * 
 * @param {Object} params the request parameters
 * @param {String} params.method the HTTP request method
 * @param {String} params.data the HTTP request body
 * @param {String} params.date the formatted HTTP request date
 * @param {String} params.path the SolarNetworkWS canonicalized path value
 * @param {String} params.token the authentication token
 * @param {String} params.secret the authentication token secret
 * @return {String} the authorization header value
 */
sn.sec.generateAuthorizationHeaderValue = function(params) {
	var msg = 
		(params.method === undefined ? 'GET' : params.method.toUpperCase()) + '\n'
		+(params.data !== undefined && shouldIncludeContentMD5(params.contentType) ? CryptoJS.MD5(params.data) : '') + '\n'
		+(params.contentType === undefined ? '' : params.contentType) + '\n'
		+params.date +'\n'
		+params.path;
	var hash = CryptoJS.HmacSHA1(msg, (params.secret || ''));
	var authHeader = params.token +':' +CryptoJS.enc.Base64.stringify(hash);
	return authHeader;
};

/**
 * Parse the query portion of a URL string, and return a parameter object for the
 * parsed key/value pairs.
 * 
 * <p>Multiple parameters of the same name are <b>not</b> supported.</p>
 * 
 * @param {String} search the query portion of the URL, which may optionally include 
 *                        the leading '?' character
 * @return {Object} the parsed query parameters, as a parameter object
 */
sn.sec.parseURLQueryTerms = function(search) {
	var params = {};
	var pairs;
	var pair;
	var i, len;
	if ( search !== undefined && search.length > 0 ) {
		// remove any leading ? character
		if ( search.match(/^\?/) ) {
			search = search.substring(1);
		}
		pairs = search.split('&');
		for ( i = 0, len = pairs.length; i < len; i++ ) {
			pair = pairs[i].split('=', 2);
			if ( pair.length === 2 ) {
				params[decodeURIComponent(pair[0])] = decodeURIComponent(pair[1]);
			}
		}
	}
	return params;
};

/**
 * Generate the SolarNetworkWS path required by the authorization header value.
 * 
 * <p>This method will parse the given URL and then apply the path canonicalization
 * rules defined by the SolarNetworkWS scheme.</p>
 * 
 * @param {String} url the request URL
 * @return {String} path the canonicalized path value to use in the SolarNetworkWS 
 *                       authorization header value
 */
sn.sec.authURLPath = function(url, data) {
	var a = document.createElement('a');
	a.href = url;
	var path = a.pathname;
	
	// handle query params, which must be sorted
	var params = sn.sec.parseURLQueryTerms(data === undefined ? a.search : data);
	var sortedKeys = [], key = undefined;
	var i, len;
	var first = true;
	
	// work around IE bug https://connect.microsoft.com/IE/Feedback/Details/1002846
	if ( path.length > 0 && path.charAt(0) !== '/' ) {
		path = '/' + path;
	}
	
	for ( key in params ) {
		sortedKeys.push(key);
	}
	sortedKeys.sort();
	if ( sortedKeys.length > 0 ) {
		path += '?';
		for ( i = 0, len = sortedKeys.length; i < len; i++ ) {
			if ( first ) {
				first = false;
			} else {
				path += '&';
			}
			path +=  sortedKeys[i];
			path += '=';
			path += params[sortedKeys[i]];
		}
	}
	return path;
};

/**
 * Invoke the web service URL, adding the required SolarNetworkWS authorization
 * headers to the request.
 * 
 * <p>This method will construct the <code>X-SN-Date</code> and <code>Authorization</code>
 * header values needed to invoke the web service. It returns a d3 XHR object,
 * so you can call <code>.on()</code> on that to handle the response, unless a callback
 * parameter is specified, then the request is issued immediately, passing the 
 * <code>method</code>, <code>data</code>, and <code>callback</code> parameters
 * to <code>xhr.send()</code>.</p>
 * 
 * @param {String} url the web service URL to invoke
 * @param {String} method the HTTP method to use; e.g. GET or POST
 * @param {String} [data] the data to upload
 * @param {String} [contentType] the content type of the data
 * @param {Function} [callback] if defined, a d3 callback function to handle the response JSON with
 * @return {Object} d3 XHR object
 */
sn.sec.json = function(url, method, data, contentType, callback) {
	var requestUrl = url;
	// We might be passed to queue, and then our callback will be the last argument (but possibly not #5
	// if the original call to queue didn't pass all arguments) so we check for that at the start and
	// adjust what we consider the method, data, and contentType parameter values.
	if ( arguments.length > 0 ) {
		if ( arguments.length < 5 && typeof arguments[arguments.length - 1] === 'function' ) {
			callback = arguments[arguments.length - 1];
		}
		if ( typeof method !== 'string' ) {
			method = undefined;
		}
		if ( typeof data !== 'string' ) {
			data = undefined;
		}
		if ( typeof contentType !== 'string' ) {
			contentType = undefined;
		}
	}
	method = (method === undefined ? 'GET' : method.toUpperCase());
	if ( method === 'POST' || method === 'PUT' ) {
		// extract any URL request parameters and put into POST body
		if ( !data ) {
			(function() {
				var queryIndex = url.indexOf('?');
				if ( queryIndex !== -1 ) {
					if ( queryIndex + 1 < url.length - 1 ) {
						data = url.substring(queryIndex + 1);
					}
					requestUrl = url.substring(0, queryIndex);
					contentType = 'application/x-www-form-urlencoded; charset=UTF-8';
				}
			}());
		}
	}
	var xhr = d3.json(requestUrl);
	if ( contentType !== undefined ) {
		xhr.header('Content-Type', contentType);
	}
	xhr.on('beforesend', function(request) {
		// get a date, which we must include as a header as well as include in the 
		// generated authorization hash
		var date = new Date().toUTCString();		
		
		// construct our canonicalized path value from our URL
		var path = sn.sec.authURLPath(url, 
			(contentType !== undefined && contentType.indexOf('application/x-www-form-urlencoded') === 0 ? data : undefined));
		
		// generate the authorization hash value now (cryptographically signing our request)
		var auth = sn.sec.generateAuthorizationHeaderValue({
			method: method,
			date: date,
			path: path,
			token: cred.token,
			secret: cred.secret,
			data: data,
			contentType: contentType
		});
		
		// set the headers on our request
		if ( data !== undefined && shouldIncludeContentMD5(contentType) ) {
			request.setRequestHeader('Content-MD5', CryptoJS.MD5(data));
		}
		request.setRequestHeader('X-SN-Date', date);
		request.setRequestHeader('Authorization', 'SolarNetworkWS ' +auth);
	});
	
	// register a load handler always, just so one is present
	xhr.on('load.internal', function() {
		//sn.log('URL {0} response received.', url);
	});
	
	if ( callback !== undefined ) {
		xhr.send(method, data, callback);
	}
	return xhr;
};

}());
