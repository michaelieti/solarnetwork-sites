/**
 * @require d3 3.0
 * @require queue 1.0
 * @require solarnetwork-d3 0.0.3
 * @require solarnetwork-d3-chart-energy-io 1.0.0
 */

sn.config.debug = true;
sn.config.host = 'data.solarnetwork.net';
sn.runtime.excludeSources = new sn.Configuration();

// handle clicks on legend handler
function legendClickHandler(d, i) {
	sn.runtime.excludeSources.toggle(d.source);
	if ( sn.runtime.energyBarIOChart !== undefined ) {
		sn.runtime.energyBarIOChart.regenerate();
		sn.adjustDisplayUnits(sn.runtime.energyBarIOContainer, 'Wh', sn.runtime.energyBarIOChart.yScale());
	}
}

// show/hide the proper range selection based on the current aggregate level
function updateRangeSelection() {
	d3.selectAll('#details div.range').style('display', function() {
		return (d3.select(this).classed(sn.runtime.energyBarIOParameters.aggregate.toLowerCase()) ? 'block' : 'none');
	});
	d3.select('#hemisphere-toggle').transition().duration(sn.runtime.energyBarIOChart.transitionMs())
		.style('opacity', (sn.runtime.energyBarIOParameters.aggregate == 'Month' ? 1 : 0));
}

function chartDataCallback(dataType, datum) {
	// create date property
	if ( datum.localDate ) {
		datum.date = sn.dateTimeFormat.parse(datum.localDate +' ' +datum.localTime);
	} else if ( datum.created ) {
		datum.date = sn.timestampFormat.parse(datum.created);
	} else {
		datum.date = null;
	}
}

function colorForDataTypeSource(dataType, sourceId, sourceIndex) {
	var mappedSourceId = sn.runtime.sourceColorMap.displaySourceMap[dataType][sourceId];
	return sn.runtime.colorData[mappedSourceId];
}

function sourceExcludeCallback(dataType, sourceId) {
	var mappedSourceId = sn.runtime.sourceColorMap.displaySourceMap[dataType][sourceId];
	return sn.runtime.excludeSources.enabled(mappedSourceId);
}

// Watt stacked area overlap chart
function setupEnergyIOChart(container, chart, parameters, endDate, sourceMap) {
	var queryRange = sn.datum.loaderQueryRange(parameters.aggregate, sn.env, endDate);
	var plotPropName = parameters.plotProperties[parameters.aggregate];
	
	container.selectAll('.time-count').text(queryRange.timeCount);
	container.selectAll('.time-unit').text(queryRange.timeUnit);
	
	sn.datum.multiLoader([
		sn.datum.loader(sourceMap['Consumption'], sn.runtime.consumptionUrlHelper, 
			queryRange.start, queryRange.end, parameters.aggregate),
		sn.datum.loader(sourceMap['Generation'], sn.runtime.urlHelper, 
			queryRange.start, queryRange.end, parameters.aggregate)
	]).callback(function(error, results) {
		if ( !(Array.isArray(results) && results.length === 2) ) {
			sn.log("Unable to load data for Energy Bar chart: {0}", error);
			return;
		}
		// note the order we call load dictates the layer order of the chart... each call starts a new layer on top of previous layers
		chart.reset()
			.load(results[0], 'Consumption')
			.load(results[1], 'Generation')
			.regenerate();
		sn.log("Energy Bar chart watt range: {0}", chart.yDomain());
		sn.log("Energy Bar chart time range: {0}", chart.xDomain());
		sn.adjustDisplayUnits(container, 'Wh', chart.yScale());
	}).load();
}

function energyBarIOChartSetup(endDate) {
	setupEnergyIOChart(
		sn.runtime.energyBarIOContainer,
		sn.runtime.energyBarIOChart,
		sn.runtime.energyBarIOParameters,
		endDate,
		sn.runtime.sourceGroupMap);
}

function setupSourceGroupMap() {
	var map = {},
		sourceArray;
	sourceArray = sn.env.sourceIds.split(/\s*,\s*/);
	map['Generation'] = sourceArray;
	
	sourceArray = sn.env.consumptionSourceIds.split(/\s*,\s*/);
	map['Consumption'] = sourceArray;
	
	sn.runtime.sourceGroupMap = map;
}

function sourceSets(regenerate) {
	if ( !sn.runtime.sourceGroupMap || !sn.runtime.sourceSets || regenerate ) {
		setupSourceGroupMap();
		sn.runtime.sourceSets = [
			{ nodeUrlHelper : sn.runtime.consumptionUrlHelper, 
				sourceIds : sn.runtime.sourceGroupMap['Consumption'], 
				dataType : 'Consumption' },
			{ nodeUrlHelper : sn.runtime.urlHelper, 
				sourceIds : sn.runtime.sourceGroupMap['Generation'], 
				dataType : 'Generation' }
		];
	}
	return sn.runtime.sourceSets;
}

function setup(repInterval) {
	sn.runtime.reportableEndDate = repInterval.eDate;
	if ( sn.runtime.sourceColorMap === undefined ) {
		sn.runtime.sourceColorMap = sn.sourceColorMapping(sn.runtime.sourceGroupMap);
	
		// we make use of sn.colorFn, so stash the required color map where expected
		sn.runtime.colorData = sn.runtime.sourceColorMap.colorMap;

		// set up form-based details
		d3.select('#details .consumption').style('color', 
				sn.runtime.sourceColorMap.colorMap[sn.runtime.sourceColorMap.displaySourceMap['Consumption'][sn.runtime.sourceGroupMap['Consumption'][0]]]);
		d3.select('#details .generation').style('color', 
				sn.runtime.sourceColorMap.colorMap[sn.runtime.sourceColorMap.displaySourceMap['Generation'][sn.runtime.sourceGroupMap['Generation'][0]]]);

		// create copy of color data for reverse ordering so labels vertically match chart layers
		sn.colorDataLegendTable('#source-labels', sn.runtime.sourceColorMap.colorMap.slice().reverse(), legendClickHandler, function(s) {
			if ( sn.env.linkOld === 'true' ) {
				s.html(function(d) {
					return '<a href="' +sn.runtime.urlHelper.nodeDashboard(d) +'">' +d +'</a>';
				});
			} else {
				s.text(Object);
			}
		});
	}

	updateRangeSelection();
	
	energyBarIOChartSetup(sn.runtime.reportableEndDate);
}

function setupUI() {
	d3.selectAll('.node-id').text(sn.env.nodeId);
	
	// update details form based on env
	d3.selectAll('#details input')
		.on('change', function(e) {
			var me = d3.select(this);
			var propName = me.attr('name');
			var getAvailable = false;
			if ( this.type === 'checkbox' ) {
				sn.env[propName] = me.property('checked');
			} else {
				sn.env[propName] = me.property('value');
			}
			if ( propName === 'consumptionNodeId' ) {
				sn.runtime.consumptionUrlHelper = sn.datum.nodeUrlHelper(sn.env[propName]);
				getAvailable = true;
			} else if ( propName === 'nodeId' ) {
				sn.runtime.urlHelper = sn.datum.nodeUrlHelper(sn.env[propName]);
				getAvailable = true;
			} else if ( propName === 'sourceIds'|| propName === 'consumptionSourceIds' ) {
				getAvailable = true;
			}
			if ( getAvailable ) {
				sn.datum.availableDataRange(sourceSets(true), function(reportableInterval) {
					delete sn.runtime.sourceColorMap; // to regenerate
					setup(reportableInterval);
				});
			} else {
				energyBarIOChartSetup(sn.runtime.reportableEndDate);
			}
		}).each(function(e) {
			var input = d3.select(this);
			var name = input.attr('name');
			if ( sn.env[name] !== undefined ) {
				if ( input.property('type') === 'checkbox' ) {
					input.attr('checked', (sn.env[name] === 'true' ? 'checked' : null));
				} else {
					input.property('value', sn.env[name]);
				}
			}
		});

	// toggle between supported aggregate levels
	d3.select('#range-toggle').classed('clickable', true).on('click', function(d, i) {
		var me = d3.select(this);
		me.classed('hit', true);
		var currAgg = sn.runtime.energyBarIOChart.aggregate();
		sn.runtime.energyBarIOParameters.aggregate = (currAgg === 'Hour' ? 'Day' : currAgg === 'Day' ? 'Month' : 'Hour');
		energyBarIOChartSetup(sn.runtime.reportableEndDate);
		setTimeout(function() {
			me.classed('hit', false);
		}, 500);
		updateRangeSelection();
	});
	
	// toggle sum lines on/off
	d3.select('#sumline-toggle').classed('clickable', true).on('click', function(d) {
		var me = d3.select(this);
		var off = me.classed('off');
		me.classed('off', !off);
		sn.runtime.energyBarIOChart.showSumLine(off);
	});
	
	// toggle hemispheres
	d3.select('#hemisphere-toggle').classed('clickable', true).on('click', function(d) {
		var me = d3.select(this);
		var south = me.classed('south');
		me.classed('south', !south);
		sn.runtime.energyBarIOChart.northernHemisphere(south);
	});
}

function onDocumentReady() {
	sn.setDefaultEnv({
		nodeId : 30,
		sourceIds : 'Main',
		consumptionNodeId : 108,
		consumptionSourceIds : 'A,B,C',
		numDays : 7,
		numMonths : 4,
		numYears : 2,
		northernHemisphere : 'false'
	});
	sn.runtime.wChartRefreshMs = 30 * 60 * 1000;
	
	sn.runtime.energyBarIOContainer = d3.select(d3.select('#energy-io-chart').node().parentNode);
	sn.runtime.energyBarIOParameters = new sn.Configuration({
		aggregate : 'Hour',
		northernHemisphere : (sn.env.northernHemisphere === 'true' ? true : false),
		plotProperties : {Hour : 'wattHours', Day : 'wattHours', Month : 'wattHours'}
	});
	sn.runtime.energyBarIOChart = sn.chart.energyIOBarChart('#energy-io-chart', sn.runtime.energyBarIOParameters)
		.dataCallback(chartDataCallback)
		.colorCallback(colorForDataTypeSource)
		.sourceExcludeCallback(sourceExcludeCallback);
	
	sn.runtime.urlHelper = sn.datum.nodeUrlHelper(sn.env.nodeId);
	sn.runtime.consumptionUrlHelper = sn.datum.nodeUrlHelper(sn.env.consumptionNodeId);

	setupUI();
	sn.datum.availableDataRange(sourceSets(), function(reportableInterval) {
		setup(reportableInterval);
		if ( sn.runtime.refreshTimer === undefined ) {
			// refresh chart data on interval
			sn.runtime.refreshTimer = setInterval(function() {
				sn.datum.availableDataRange(sourceSets(), function(repInterval) {
					var jsonEndDate = repInterval.eDate;
					if ( jsonEndDate.getTime() > sn.runtime.reportableEndDate.getTime() ) {
						setup(repInterval);
					}
				});
			}, sn.runtime.wChartRefreshMs);
		}
	});

	setupUI();
}
