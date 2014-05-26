/**
 * @require d3 3.0
 * @require queue 1.0
 * @require solarnetwork-d3 0.0.3
 * @require solarnetwork-d3-chart-energy-io 1.0.0
 */

sn.config.debug = true;
sn.config.host = 'data.solarnetwork.net';
sn.runtime.excludeSources = new sn.Configuration();

function setup(repInterval, sourceMap) {
	var reportableEndDate = repInterval.eDate;
	var energyBarChart = undefined;
	var monthEnergyBarChart = undefined;
	var sourceColorMap = sn.sourceColorMapping(sourceMap);
	
	// we make use of sn.colorFn, so stash the required color map where expected
	sn.runtime.colorData = sourceColorMap.colorMap;
	
	// adjust display units as needed (between W and kW, etc)
	function adjustChartDisplayUnits(chartKey, baseUnit, scale) {
		var unit = (scale === 1000000 ? 'M' : scale === 1000 ? 'k' : '') + baseUnit;
		d3.selectAll(chartKey +' .unit').text(unit);
	}

	// handle clicks on legend handler
	function legendClickHandler(d, i) {
		sn.runtime.excludeSources.toggle(d.source);
		if ( energyBarChart !== undefined ) {
			// use a slight delay, otherwise transitions can be jittery
			setTimeout(function() {
				energyBarChart.regenerate();
				adjustChartDisplayUnits('.watthour-chart.days', 'Wh', energyBarChart.yScale());
			}, energyBarChart.transitionMs() * 0.5);
		}
		if ( monthEnergyBarChart !== undefined ) {
			// use a slight delay, otherwise transitions can be jittery
			setTimeout(function() {
				if ( monthEnergyBarChart !== undefined ) {
					adjustChartDisplayUnits('.watthour-chart.months', 'Wh', monthEnergyBarChart.yScale());
				}
			}, monthEnergyBarChart.transitionMs() * 0.5);
		}
	}

	// create copy of color data for reverse ordering so labels vertically match chart layers
	sn.colorDataLegendTable('#source-labels', sourceColorMap.colorMap.slice().reverse(), legendClickHandler, function(s) {
		if ( sn.env.linkOld === 'true' ) {
			s.html(function(d) {
				return '<a href="' +sn.runtime.urlHelper.nodeDashboard(d) +'">' +d +'</a>';
			});
		} else {
			s.text(Object);
		}
	});
	
	var wattHourAggregate = 'Hour';

	// Watt hour stacked bar chart (hours)
	function wattHourChartSetup(endDate) {
		var end;
		var start;
		var timeCount;
		var timeUnit;
		if ( wattHourAggregate === 'Day' ) {
			timeCount = sn.env.numMonths;
			timeUnit = 'month';
			end = d3.time.month(endDate);
			start = d3.time.month.offset(end, sn.env.numMonths ? (1 - sn.env.numMonths) : -3);
			start = d3.time.day.offset(start, endDate.getDate());
		} else {
			// assume Hour
			timeCount = sn.env.numDays;
			timeUnit = 'day';
			end = d3.time.hour(endDate);
			start = d3.time.day.offset(end, sn.env.numDays ? (1 - sn.env.numDays) : -6);
		}
		if ( energyBarChart === undefined ) {
			energyBarChart = sn.chart.energyIOBarChart('#watthour-chart', {
				excludeSources: sn.runtime.excludeSources,
			});
		}
		
		d3.select('.watthour-chart .time-count').text(timeCount);
		d3.select('.watthour-chart .time-unit').text(timeUnit);
		
		var q = queue();
		sn.env.dataTypes.forEach(function(e, i) {
			var urlHelper = (i === 0 ? sn.runtime.devUrlHelper : sn.runtime.urlHelper); // FIXME: remove
			q.defer(d3.json, urlHelper.dateTimeQuery(e, start, endDate, wattHourAggregate));
		});
		q.awaitAll(function(error, results) {
			if ( error ) {
				sn.log('Error requesting data: ' +error);
				return;
			}
			var combinedData = [];
			var i, iMax, j, jMax, json, datum, mappedSourceId;
			for ( i = 0, iMax = results.length; i < iMax; i++ ) {
				json = results[i];
				if ( json.success !== true || Array.isArray(json.data) !== true ) {
					sn.log('No data available for node {0} data type {1}', sn.runtime.urlHelper.nodeId(), sn.env.dataTypes[i]);
					return;
				}
				for ( j = 0, jMax = json.data.length; j < jMax; j++ ) {
					datum = json.data[j];
					mappedSourceId = sourceColorMap.displaySourceMap[sn.env.dataTypes[i]][datum.sourceId];
					if ( mappedSourceId !== undefined ) {
						datum.sourceId = mappedSourceId;
					}
				}
				combinedData = combinedData.concat(json.data);
			}
			energyBarChart.consumptionSourceCount(sourceMap[sn.env.dataTypes[0]].length);
			energyBarChart.load(combinedData, {
				aggregate : wattHourAggregate
			});
			sn.log("Energy IO chart watt hour range: {0}", energyBarChart.yDomain());
			sn.log("Energy IO chart time range: {0}", energyBarChart.xDomain());
			adjustChartDisplayUnits('.watthour-chart', 'Wh', energyBarChart.yScale());
		});
	}
	wattHourChartSetup(reportableEndDate);

	d3.select('#range-toggle').classed('clickable', true).on('click', function(d, i) {
		var currAgg = energyBarChart.aggregate();
		wattHourAggregate = (currAgg === 'Day' ? 'Hour' : 'Day');
		wattHourChartSetup(reportableEndDate);
	});
	

	// Watt hour stacked bar chart (hours)
	function wattHourMonthChartSetup(endDate) {
		var monthEnd = d3.time.month(endDate);
		var monthStart = d3.time.month.offset(monthEnd, sn.env.numMonths ? (1 - sn.env.numMonths) : -3);
		monthEnergyBarChart = sn.chart.energyIOBarChart('#month-watthour', {
			excludeSources : sn.runtime.excludeSources,
			aggregate : 'Day'
		});
		var q = queue();
		sn.env.dataTypes.forEach(function(e, i) {
			var urlHelper = (i === 0 ? sn.runtime.devUrlHelper : sn.runtime.urlHelper); // FIXME: remove
			q.defer(d3.json, urlHelper.dateTimeQuery(e, monthStart, endDate, 'Day'));
		});
		q.awaitAll(function(error, results) {
			if ( error ) {
				sn.log('Error requesting data: ' +error);
				return;
			}
			var combinedData = [];
			var i, iMax, j, jMax, json, datum, mappedSourceId;
			for ( i = 0, iMax = results.length; i < iMax; i++ ) {
				json = results[i];
				if ( json.success !== true || Array.isArray(json.data) !== true ) {
					sn.log('No data available for node {0} data type {1}', sn.runtime.urlHelper.nodeId(), sn.env.dataTypes[i]);
					return;
				}
				for ( j = 0, jMax = json.data.length; j < jMax; j++ ) {
					datum = json.data[j];
					mappedSourceId = sourceColorMap.displaySourceMap[sn.env.dataTypes[i]][datum.sourceId];
					if ( mappedSourceId !== undefined ) {
						datum.sourceId = mappedSourceId;
					}
				}
				combinedData = combinedData.concat(json.data);
			}
			monthEnergyBarChart.consumptionSourceCount(sourceMap[sn.env.dataTypes[0]].length);
			monthEnergyBarChart.load(combinedData);
			sn.log("Energy IO chart watt hour range: {0}", monthEnergyBarChart.yDomain());
			sn.log("Energy IO chart time range: {0}", monthEnergyBarChart.xDomain());
			adjustChartDisplayUnits('.watthour-chart', 'Wh', monthEnergyBarChart.yScale());
		});
	}
	//wattHourMonthChartSetup(reportableEndDate);
	
	// refresh chart data on interval
	setInterval(function() {
		d3.json(sn.runtime.urlHelper.reportableInterval(sn.env.dataTypes), function(error, json) {
			if ( json.data === undefined || json.data.endDateMillis === undefined ) {
				sn.log('No data available for node {0}: {1}', sn.runtime.urlHelper.nodeId(), (error ? error : 'unknown reason'));
				return;
			}
			if ( energyBarChart !== undefined ) {
				var jsonEndDate = sn.dateTimeFormat.parse(json.data.endDate);
				var xDomain = energyBarChart.xDomain();
				var currEndDate = xDomain[xDomain.length - 1];
				var newEndDate = new Date(jsonEndDate.getTime());
				currEndDate.setMinutes(0,0,0); // truncate to nearest hour
				newEndDate.setMinutes(0,0,0);
				if ( newEndDate.getTime() > currEndDate.getTime() ) {
					reportableEndDate = jsonEndDate;
					wattHourChartSetup(reportableEndDate);
				}
			}
		});
	}, sn.config.wChartRefreshMs);
	
}

function onDocumentReady() {
	sn.setDefaultEnv({
		nodeId : 30,
		consumptionNodeId : 108,
		numDays : 7,
		numMonths : 4,
		maxPowerKW : 3,
		dataTypes: ['Consumption', 'Power']
	});
	sn.config.wChartRefreshMs = 30 * 60 * 1000;
	
	d3.selectAll('.node-id').text(sn.env.nodeId);
	
	// find our available data range, and then draw our charts!
	function handleAvailableDataRange(event) {
		setup(event.data.reportableInterval, event.data.availableSourcesMap);
		document.removeEventListener('snAvailableDataRange', handleAvailableDataRange, false);
	}
	document.addEventListener('snAvailableDataRange', handleAvailableDataRange, false);
	sn.runtime.urlHelper = sn.nodeUrlHelper(sn.env.nodeId);
	sn.runtime.devUrlHelper = sn.nodeUrlHelper(sn.env.consumptionNodeId);
	sn.availableDataRange(function(e, i) {
		if ( !arguments.length ) return sn.runtime.urlHelper;
		return (i === 0 ? sn.runtime.devUrlHelper : sn.runtime.urlHelper);
	}, sn.env.dataTypes);
}
