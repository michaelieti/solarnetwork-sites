/**
 * @require d3 3.0
 * @require solarnetwork-d3 0.0.2
 */

sn.config.debug = true;
sn.config.defaultTransitionMs = 600;
sn.config.host = 'data.solarnetwork.net';
sn.runtime.globalCounter = sn.counter();
sn.runtime.excludeSources = new sn.Configuration();

function stackWattHourChart(rawData, containerSelector) {

	var sources = [];
	
	// turn filteredData object into proper array, sorted by date
	var dataArray = sn.powerPerSourceArray(rawData, sources);
	sn.log('Available bar sources: {0}', sources);
	
	var p = [10, 10, 30, 20], // top, right, bottom, left
		w = 844 - p[1] - p[3],
		h = 300 - p[0] - p[2],
		x = d3.time.scale().range([0, w]),
		y = d3.scale.linear().range([0, h]),
		format = d3.time.format("%H");
	var showYUnits = false;
	var ticks = undefined;
	
	var svgRoot = d3.select(containerSelector).select('svg');
	if ( svgRoot.empty() ) {
		svgRoot = d3.select(containerSelector).append('svg:svg')
			.attr('class', 'crisp chart')
			.attr("width", w + p[1] + p[3])
			.attr("height", h + p[0] + p[2]);
	} else {
		svgRoot.selectAll('*').remove();
	}

	svgRoot.append("g")
		.attr("class", "rule")
		.attr("transform", "translate(0," + (h + p[0]) + ")");
		
	// Transpose the data into 2D array of watt layers by source, e.g.
	// [ [{x:0,y:0},{x:1,y:1}...], ... ]
	var layerGenerator = sn.powerPerSourceStackedLayerGenerator(sources, 'wattHours')
		.excludeSources(sn.runtime.excludeSources)
		.data(dataArray);
	var layers = layerGenerator();
	
	// Create daily aggregated data, in form [ { date: Date(2011-12-02 12:00), wattHoursTotal: 12312 }, ... ]
	function calculateDailyAggregateWh() {
		var results = [];
		var i, j, len;
		var startIndex = undefined;
		var endIndex = undefined;
		var currDayData = undefined;
		var obj = undefined;
		var day1 = ticks[0];

		// calculate first x index for midnight
		for ( i = 0, len = layers[0].length; i < len; i++ ) {
			if ( layers[0][i].x.getHours() === 0 ) {
				startIndex = i;
				break;
			}
		}
		
		endIndex = layers[0].length;
		
		// sum up values for each day
		if ( startIndex !== undefined && endIndex !== undefined && startIndex < endIndex) {
			len = layers.length;
			for ( i = 0; i < endIndex; i++ ) {
				for ( j = 0; j < len; j++ ) {
					if ( sn.runtime.excludeSources[layers[j].source] !== undefined ) {
						continue;
					}
					obj = layers[j][i];
					if ( obj.x.getTime() < day1.getTime() ) {
						// skip before first tick
						continue;
					}
					if ( currDayData === undefined || obj.x.getDate() !== currDayData.date.getDate()
							|| obj.x.getMonth() !== currDayData.date.getMonth() 
							|| obj.x.getYear() !== currDayData.date.getYear() ) {
						currDayData = {date:new Date(obj.x.getTime()), wattHoursTotal:(i < startIndex ? null : 0)};
						currDayData.date.setHours(0,0,0,0);
						results.push(currDayData);
					}
					if ( i >= startIndex ) {
						currDayData.wattHoursTotal += obj.y;
					}
				}
			}
		}
		return results;
	}
	
	function computeDomainX() {
		// Add extra x domain to accommodate bar width, otherwise last bar is cut off right edge of chart
		var xMax = layers.domainX[1];
		xMax = new Date(xMax.getTime() + (xMax.getTime() - layers[0][layers[0].length - 2].x.getTime()));
		x.domain([layers.domainX[0], xMax]);
	}

	function computeDomainY() {
		y.domain([0, layers.maxY]).nice();
		sn.log("Wh max set to {0}", layers.maxY);
	}
	
	var barWidth = (layers[0].length === 0 ? 0 : (w / (layers[0].length)));
	
	computeDomainX();
	computeDomainY();

	ticks = x.ticks(d3.time.hours, 12);

	var dailyAggregateWh = calculateDailyAggregateWh();

	// setup clip path, so axis is crisp
	var clipId = 'Clip' +sn.runtime.globalCounter.incrementAndGet();
	svgRoot.append('clipPath')
			.attr('id', clipId)
		.append('rect')
			.attr('x', 0)
			.attr('y', -(h + p[0]))
			.attr('width', w)
			.attr('height', h + p[0]);

	var svg = svgRoot.append("g")
		.attr('class', 'data')
		.attr("transform", "translate(" + p[3] + "," + (h + p[0]) + ")");
	
	var aggGroup = svgRoot.append("g")
		.attr('class', 'agg')
		.attr("transform", "translate(" + p[3] + "," + (h + p[0]) + ")");
	
	// setup display units in kWh if domain range > 1000
	var displayUnits = 'Wh';
	var displayFactor = 1;
	var displayFormat = (function() {
		var fmt = ',d';
		var domain = y.domain();
		if ( domain[domain.length - 1] >= 1000 ) {
			displayUnits = 'kWh';
			displayFactor = 1000;
			fmt = ',g';
		}
		var fn = d3.format(fmt);
		return function(d) { return fn(d / displayFactor); };
	})();
	
	if ( showYUnits === true ) {
		// Add unit label
		svgRoot.append('text')
			.attr('class', 'label')
			.attr('transform', 'rotate(-90) translate(' +(Math.round(-h/2)-p[0]) +',12)')
			.text(displayUnits);
	}

	// Add date labels, centered within associated band
	svg.selectAll("text")
	  .data(ticks)
	.enter().append("text")
	  .attr("x", function(d) { return x(d) + (barWidth / 2); })
	  .attr("y", 6)
	  .attr("dy", ".71em")
	  .text(x.tickFormat(ticks.length));

	// x axis line, on top of chart
	svgRoot.append("g")
		.attr('class', 'crisp axis')
		.attr("transform", "translate(0," + (h + p[0]) + ")")
	.selectAll('line.axis')
		.data(y.ticks(5).filter(function(d, i) { return (i === 0); }))
	.enter().append('svg:line')
		.attr('class', 'axis')
		.attr('x1', p[3])
		.attr('x2', w + p[3])
		.attr('y1', function(d) { return y(d); })
		.attr('y2', function(d) { return y(d); });
	
	// Add a group for each source.
	var source = svg.selectAll("g.source")
			.data(layers)
		.enter().append("g")
			.attr("class", "source")
			.attr('clip-path', 'url(#' +clipId +')') // clip makes bottom nice and crisp
			.style("fill", sn.colorFn);
	
	// Add a rect for each date.
	source.selectAll("rect")
			.data(Object)
		.enter().append("rect")
			.attr("x", function(d) { return x(d.x); })
			.attr("y", 1e-6)
			.attr("height", 1e-6)
			.attr("width", barWidth);
	
	var axisXAggPosFn = function(d) { return x(d) + (barWidth / 2); };
	var axisXAggTextFn = function(d, i) { 
		return (i < dailyAggregateWh.length 
			? dailyAggregateWh[i].wattHoursTotal === null 
				? '' : Number(dailyAggregateWh[i].wattHoursTotal / displayFactor).toFixed(2)
			: 0);
	};
	
	adjustAxisY();
	adjustAxisXAggregate();
	redraw();
	
	function redraw() {
		source.selectAll("rect")
				.data(Object)
			.transition().duration(sn.config.defaultTransitionMs)
				.attr("y", function(d) { return -y(d.y0) - y(d.y); })
				.attr("height", function(d) { return y(d.y); });
	}
	
	function adjustAxisY() {
		var axisLines = svgRoot.select("g.rule").selectAll("g").data(y.ticks(5));
		axisLines.transition().duration(sn.config.defaultTransitionMs)
				.attr("transform", function(d) { return "translate(0," + -y(d) + ")"; })
			.select("text")
				.text(displayFormat);
		
	  	axisLines.exit().transition().duration(sn.config.defaultTransitionMs)
	  			.style("opacity", 1e-6)
	  			.remove();
	  			
		var entered = axisLines.enter()
				.append("g")
				.style("opacity", 1e-6)
	  			.attr("transform", function(d) { return "translate(0," + -y(d) + ")"; });
	  	entered.append("line")
				.attr("x2", w + p[3])
				.attr('x1', p[3]);
		entered.append("text")
				.attr("x", p[3])
				.attr('dx', -5)
				.attr("text-anchor", "end")
				.attr("dy", ".35em")
				.text(displayFormat);
		entered.transition().duration(sn.config.defaultTransitionMs)
				.style("opacity", 1);
	}
	
	function adjustAxisXAggregate() {
		// Add daily aggregate labels, centered within associated band at noon
		var aggTicks = ticks.filter(function(d) { return d.getHours() === 12; });
		var aggLabels = aggGroup.selectAll("text").data(aggTicks);
		
		aggLabels.transition().duration(sn.config.defaultTransitionMs)
				.attr("x", axisXAggPosFn)
				.text(axisXAggTextFn);
			
		aggLabels.exit().transition().duration(sn.config.defaultTransitionMs)
	  			.style("opacity", 1e-6)
	  			.remove();

		aggLabels.enter().append("text")
				.attr("x", axisXAggPosFn)
				.attr("y", 22)
				.attr("dy", ".71em")
				.style("opacity", 1e-6)
				.text(axisXAggTextFn)
			.transition().duration(sn.config.defaultTransitionMs)
				.style("opacity", 1);
	}
	
	return {
		yScale : function() {
			return displayFactor;
		},
		
		sources: sources,
		
		xDomain: function() {
			return x.domain();
		},
		
		regenerate: function() {
			layers = layerGenerator();
			dailyAggregateWh = calculateDailyAggregateWh();
			computeDomainY();
			svg.selectAll("g.source").data(layers);
			redraw();
			adjustAxisY();
			adjustAxisXAggregate();
		}
	};
}

function areaWattChart(rawData, containerSelector) {
	var sources = [];
	var p = [10, 10, 30, 20], // top, right, bottom, left padding
		w = 844 - p[1] - p[3],
		h = 300 - p[0] - p[2],
    	x = d3.time.scale().range([0, w]),
		y = d3.scale.linear().range([h, 0]),
		format = d3.time.format("%H");
	var showYUnits = false;
	var svgRoot = undefined,
		svg = undefined;

	// turn filteredData object into proper array, sorted by date
	var dataArray = sn.powerPerSourceArray(rawData, sources);
	sn.log('Available area sources: {0}', sources);

	// Transpose the data into watt layers by source, e.g.
	// [ [{x:0,y:0},{x:1,y:1}...], ... ]
	var layerGenerator = sn.powerPerSourceStackedLayerGenerator(sources, 'watts')
		.excludeSources(sn.runtime.excludeSources)
		.offset(sn.env.wiggle === 'true' ? 'wiggle' : 'zero')
		.data(dataArray);
	var layers = layerGenerator();
		
	function strokeColorFn(d, i) { return d3.rgb(sn.colorFn(d,i)).darker(); }

	var areaPathGenerator = d3.svg.area()
		.interpolate("monotone")
		.x(function(d) { return x(d.x); })
		.y0(function(d) { return y(d.y0); })
		.y1(function(d) { return y(d.y0 + d.y); });
	
	function computeDomainX() {
		x.domain(layers.domainX);
	}

	function computeDomainY() {
		y.domain([0, layers.maxY]).nice();
		sn.log("W max set to {0}", layers.maxY);
	}

	// Compute the x-domain (by date) and y-domain (by top).
	computeDomainX();
	computeDomainY();

	svgRoot = d3.select(containerSelector).select('svg');
	if ( svgRoot.empty() ) {
		svgRoot = d3.select(containerSelector).append('svg:svg')
			.attr('class', 'chart')
			.attr("width", w + p[1] + p[3])
			.attr("height", h + p[0] + p[2]);
			//.attr("pointer-events", "all")
   			//.call(d3.behavior.zoom().on("zoom", redraw));
	} else {
		svgRoot.selectAll('*').remove();
	}

	svgRoot.append("g")
		.attr("class", "crisp rule")
		.attr("transform", "translate(0," + p[0] + ")");
	
	// setup clip path, so axis is crisp
	var clipId = 'Clip' +sn.runtime.globalCounter.incrementAndGet();
	svgRoot.append('svg:clipPath')
			.attr('id', clipId)
		.append('svg:rect')
			.attr('x', 0)
			.attr('y', -p[0])
			.attr('width', w)
			.attr('height', h + p[0]);

	svg = svgRoot.append("g")
		.attr('class', 'data')
		.attr("transform", "translate(" + p[3] + "," + p[0] + ")");
	
	// Set y-axis  unit label
	// setup display units in kW if domain range > 1000
	var displayUnits = 'W';
	var displayFactor = 1;
	var displayFormat = (function() {
		var fmt = ',d';
		var domain = y.domain();
		if ( domain[domain.length - 1] >= 1000 ) {
			displayUnits = 'kW';
			displayFactor = 1000;
			fmt = ',g';
		}
		var fn = d3.format(fmt);
		return function(d) { return fn(d / displayFactor); };
	})();
	
	if ( showYUnits === true ) {
		svgRoot.selectAll('text.unit')
			.data([1])
				.text(displayUnits)
			.enter().append('text')
				.attr('class', 'unit label')
				.attr('transform', 'rotate(-90) translate(' +(Math.round(-h/2)-p[0]) +',12)')
				.text(displayUnits);
	}
	
	function redraw() {	
		// draw data areas
		var area = svg.selectAll("path.area").data(layers);
		
		area.transition().duration(sn.config.defaultTransitionMs).delay(200)
				.attr("d", areaPathGenerator);
		
		area.enter().append("path")
				.attr("class", "area")
				.attr('clip-path', 'url(#' +clipId +')')
				.style("fill", sn.colorFn)
				.attr("d", areaPathGenerator);
		
		area.exit().remove();
	}

	function axisYTransform(d) { return "translate(0," + y(d) + ")"; };

	function adjustAxisX() {
		if ( d3.event && d3.event.transform ) {
			d3.event.transform(x);
		}
		var numTicks = 12;
		var fx = x.tickFormat(numTicks);
		var ticks = x.ticks(numTicks);

		// Generate x-ticks
		var gx = svg.selectAll("g.data text")
			.data(ticks)
				.attr("x", x)
				.text(fx);
		gx.enter().append("text")
				.attr("x", x)
				.attr("y", h + 6)
				.attr("dy", ".71em")
				.text(fx);
		gx.exit().remove();
	}

	function adjustAxisY() {
		if ( sn.env.wiggle === 'true' ) {
			return;
		}

		var axisLines = svgRoot.select("g.rule").selectAll("g").data(y.ticks(5));
		axisLines.transition().duration(sn.config.defaultTransitionMs)
				.attr("transform", axisYTransform)
			.select("text")
				.text(displayFormat);
		
	  	axisLines.exit().transition().duration(sn.config.defaultTransitionMs)
	  			.style("opacity", 1e-6)
	  			.remove();
	  			
		var entered = axisLines.enter()
				.append("g")
				.style("opacity", 1e-6)
	  			.attr("transform", axisYTransform);
	  	entered.append("line")
				.attr("x2", w + p[3])
				.attr('x1', p[3]);
		entered.append("text")
				.attr("x", p[3])
				.attr('dx', -5)
				.attr("text-anchor", "end")
				.attr("dy", ".35em")
				.text(displayFormat);
		entered.transition().duration(sn.config.defaultTransitionMs)
				.style("opacity", 1);
	}

	redraw();
	adjustAxisX();
	adjustAxisY();
		
	return {
		yScale : function() {
			return displayFactor;
		},
		
		sources: sources,
		
		xDomain: function() {
			return x.domain();
		},
		
		regenerate: function() {
			layers = layerGenerator();
			computeDomainY();
			svg.selectAll("g.source").data(layers);
			redraw();
			adjustAxisY();
		}
	};
}

function setup(repInterval, sourceList) {
	var endDate = repInterval.eDate;
	var whChart = undefined;
	var wChart = undefined;

	// create static mapping of source -> color, so consistent across charts
	sn.runtime.colorData = sn.colorMap(sn.colors.steelblue, sourceList);
	
	// create copy of color data for reverse ordering so labels vertically match chart layers
	sn.colorDataLegendTable('#source-labels', sn.runtime.colorData.slice().reverse(), legendClickHandler, function(s) {
		if ( sn.env.linkOld === 'true' ) {
			s.html(function(d) {
				return '<a href="' +sn.runtime.urlHelper.nodeDashboard(d) +'">' +d +'</a>';
			});
		} else {
			s.text(Object);
		}
	});
	
	// adjust display units as needed
	function adjustChartDisplayUnits(chartKey, baseUnit, scale) {
		var unit = (scale === 1000 ? 'k' : '') + baseUnit;
		d3.selectAll(chartKey +' .unit').text(unit);
	}
	
	var e = new Date(endDate.getTime());
	e.setMinutes(0,0,0); // truncate to nearest hour

	// Wh chart, agg by hour
	var whRange = [
			new Date(e.getTime() - ((sn.env.numDays * 24 - 1) * 60 * 60 * 1000)),
			new Date(e.getTime())
		];
	d3.json(sn.runtime.urlHelper.dateTimeQuery(sn.env.dataType, whRange[0], whRange[1], 'Hour'), function(json) {
		whChart = stackWattHourChart(json.data, '#week-watthour');
		adjustChartDisplayUnits('.watthour-chart', 'Wh', whChart.yScale());
	});

	// Watt stacked area chart
	function wattChartSetup(endDate) {
		var e = new Date(endDate.getTime());
		// truncate end date to nearest day precision minutes
		e.setMinutes((endDate.getMinutes() - (endDate.getMinutes() % sn.env.minutePrecision)), 0, 0);
		
		var wRange = [
			new Date(e.getTime() - (sn.env.numHours * 60 * 60 * 1000)), 
			new Date(e.getTime())
			];
		d3.json(sn.runtime.urlHelper.dateTimeQuery(sn.env.dataType, wRange[0], wRange[1], sn.env.minutePrecision), function(json) {
			wChart = areaWattChart(json.data, '#day-watt');
			adjustChartDisplayUnits('.watt-chart', 'W', wChart.yScale());
		});
	}
	
	wattChartSetup(endDate);
	setInterval(function() {
		d3.json(sn.runtime.urlHelper.reportableInterval([sn.env.dataType]), function(error, json) {
			if ( json.data === undefined || json.data.endDateMillis === undefined ) {
				sn.log('No data available for node {0}: {1}', sn.runtime.urlHelper.nodeId(), (error ? error : 'unknown reason'));
				return;
			}
			
			var endDate = sn.dateTimeFormat.parse(json.data.endDate);
			wChart = wattChartSetup(endDate);
			if ( whChart !== undefined ) {
				var xDomain = whChart.xDomain();
				var currEndDate = xDomain[xDomain.length - 1];
				var newEndDate = new Date(endDate.getTime());
				currEndDate.setMinutes(0,0,0); // truncate to nearest hour
				newEndDate.setMinutes(0,0,0);
				if ( newEndDate.getTime() > currEndDate.getTime() ) {
					d3.json(sn.runtime.urlHelper.dateTimeQuery(sn.env.dataType, new Date(newEndDate.getTime() - ((sn.env.numDays * 24 - 1) * 60 * 60 * 1000)), newEndDate, 'Hour'), function(json) {
						whChart = stackWattHourChart(json.data, '#week-watthour');
					});
				}
			}
		});
	}, sn.config.wChartRefreshMs);
	
	function legendClickHandler(d, i) {
		sn.runtime.excludeSources.toggle(d.source);
		if ( whChart !== undefined ) {
			whChart.regenerate();
			adjustChartDisplayUnits('.watthour-chart', 'Wh', whChart.yScale());
		}
		if ( wChart !== undefined ) {
			// use a slight delay, otherwise transitions can be jittery
			setTimeout(function() {
				wChart.regenerate();
				adjustChartDisplayUnits('.watt-chart', 'W', wChart.yScale());
			}, sn.config.defaultTransitionMs * .8);
		}
	}

	function updateReadings() {
		d3.json(sn.runtime.urlHelper.mostRecentQuery(sn.env.dataType), function(json) {
			if ( json.data === undefined ) {
				sn.log('No data available for node {0}', sn.runtime.urlHelper.nodeId());
				return;
			}
			// totalPower, in kW
			var totalPower = d3.sum(json.data, function(d) { return d.watts; }) / 1000;
			d3.select('#total-power-value').html(Number(totalPower).toFixed(2));
		});
	}
	
	// every minute update reading values
	updateReadings();
	setInterval(function() {
		updateReadings();
	}, 60 * 1000);
}

function onDocumentReady() {
	sn.setDefaultEnv({
		nodeId : 11,
		dataType : 'Consumption',
		minutePrecision : 10,
		numHours : 24,
		numDays : 7,
		wiggle : 'true',
		linkOld : 'false',
	});
	sn.config.wChartRefreshMs = sn.env.minutePrecision * 60 * 1000;
	
	// setup DOM based on environment
	d3.select('#num-days').text(sn.env.numDays);
	d3.select('#num-hours').text(sn.env.numHours);
	d3.selectAll('.watt-chart .dataType').text((function() {
		if ( sn.env.dataType === 'Consumption' ) {
			return 'use';
		}
		return 'output';
	})());
	d3.selectAll('.watthour-chart .dataType').text((function() {
		if ( sn.env.dataType === 'Consumption' ) {
			return 'consumption';
		}
		return 'production';
	})());
	d3.selectAll('.total-power .dataType').text((function() {
		if ( sn.env.dataType === 'Consumption' ) {
			return 'Use';
		}
		return 'Power';
	})());
	d3.selectAll('.node-id').text(sn.env.nodeId);
	
	// find our available data range, and then draw our charts!
	function handleAvailableDataRange(event) {
		setup(event.data.reportableInterval, event.data.availableSources);
		document.removeEventListener('snAvailableDataRange', handleAvailableDataRange, false);
	}
	document.addEventListener('snAvailableDataRange', handleAvailableDataRange, false);
	sn.runtime.urlHelper = sn.nodeUrlHelper(sn.env.nodeId);
	sn.availableDataRange(sn.runtime.urlHelper, [sn.env.dataType]);
}