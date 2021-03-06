/**
 * @require d3 3.0
 * @require queue 1.0
 * @require solarnetwork-d3 0.0.5
 * @require solarnetwork-d3-datum 1.0.0
 * @require solarnetwork-d3-util-counter 1.0.0
 */

sn.config.debug = true;

function setupToggler() {
	var toggle = $('#toggle-toggle');
	var progress = $('#toggle-progress');
	if ( sn.runtime.toggler === undefined && sn.net.sec.hasTokenCredentials() ) {
		// NOTE: we show the switch as ON when the PCM is allowing 100% output, 
		//       and OFF when the PCM is limiting the output at 0%; this is
		//       then opposite the control value, where 1 === PCM at 0% and
		//       0 === 100% output
		sn.runtime.toggler = sn.api.control.toggler(sn.runtime.urlHelper)
			.controlID(sn.env.controlId)
			.callback(function(error) {
				if ( error ) {
					if ( error.status ) {
						if ( error.status === 401 || error.status === 403 ) {
							alert('Unauthorized.');
							sn.net.sec.clearSecret();
							if ( sn.runtime.toggler ) {
								sn.runtime.toggler.stop();
							}
						} else {
							sn.log('Error updating toggle status: {0}', error.statusText);
						}
					} else {
						sn.log('Error updating toggle status: {0}', error);
					}
				} else {
					var controlValue = this.value();
					d3.select('#toggle-progress .status').text(this.pendingInstructionState());
					if ( d3.set(['Queued','Received','Executing']).has(this.pendingInstructionState())  ) {
						progress.show();
						controlValue = this.pendingInstructionValue();
					} else {
						progress.hide();
					}
					toggle.bootstrapSwitch('setState', (controlValue === 0));
					toggle.bootstrapSwitch('setActive', true);
				}
			});
		sn.runtime.toggler.start();
	} else if ( sn.runtime.toggler ) {
		sn.runtime.toggler.stop().start();
	}
}

function setupUI() {
	d3.selectAll('#details input')
		.on('change', function(e) {
			var me = d3.select(this);
			var propName = me.attr('name');
			var getAvailable = false;
			sn.env[propName] = me.property('value');
			if ( propName === 'nodeId' ) {
				sn.runtime.urlHelper.nodeID(sn.env[propName]);
			} else if ( propName === 'controlId' ) {
				if ( sn.runtime.toggler ) {
					sn.runtime.toggler.controlID(sn.env[propName]);
				}
			}
			if ( sn.runtime.toggler ) {
				sn.runtime.toggler.stop().start();
			}
		}).each(function(e) {
			var input = d3.select(this);
			var name = input.attr('name');
			if ( sn.env[name] ) {
				input.property('value', sn.env[name]);
			}
		});
		
	d3.selectAll('.node-id').text(sn.env.nodeId);
	d3.select('#toggle-toggle').attr('data-text-label', sn.env.controlDisplayName);
	d3.select('#toggle-toggle label').text(sn.env.controlDisplayName);

	d3.select('#toggle-toggle').on('click', function() {
		if ( !(sn.net.sec.token() && sn.net.sec.hasSecret()) ) {
			// we need to ask for credentials
			$('#credentals-modal').modal('show');	
		}
	});
	$('#credentals-modal').on('hidden.bs.modal', function() {
		var val = d3.select('#cred-token').property('value');
		if ( val.length === 0 ) {
			val = undefined;
		}
		sn.net.sec.token(val);

		val = d3.select('#cred-secret').property('value');
		if ( val.length === 0 ) {
			val = undefined;
		}
		sn.net.sec.secret(val);
		
		// clear the secret
		d3.select('#cred-secret').property('value', '');
		
		// for now, we can assume the credential request was from the toggle button, so try the toggle again
		setupToggler();
	}).on('shown.bs.modal', function() {
		$('#cred-token').focus();
	});
	$('#toggle-toggle').on('switch-change', function(e, data) {
		if ( sn.runtime.toggler ) {
			sn.runtime.toggler.value(data.value ? 0 : 1);
		}
	});
}

function onDocumentReady() {
	sn.setDefaultEnv({
		nodeId : 1013,
		controlId : '/power/switch/1',
		controlDisplayName : 'Switch'
	});
	sn.runtime.urlHelper = sn.api.node.nodeUrlHelper(sn.env.nodeId);
	setupUI();
	setupToggler();
}
