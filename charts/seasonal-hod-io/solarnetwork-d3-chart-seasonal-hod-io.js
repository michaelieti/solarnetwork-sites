/**
 * @require d3 3.0
 * @require solarnetwork-d3 0.0.3
 */

if ( sn === undefined ) {
	sn = { chart: {} };
} else if ( sn.chart === undefined ) {
	sn.chart = {};
}

/**
 * @typedef sn.chart.seasonalHourOfDayLineChartParameters
 * @type {sn.Configuration}
 * @property {number} [width=812] - desired width, in pixels, of the chart
 * @property {number} [height=300] - desired height, in pixels, of the chart
 * @property {number[]} [padding=[30, 0, 30, 30]] - padding to inset the chart by, in top, right, bottom, left order
 * @property {number} [transitionMs=600] - transition time
 * @property {number} [ruleOpacity] - the maximum opacity to render rules at, during transitions
 * @property {number} [vertRuleOpacity] - the maximum opacity to render rules at, during transitions
 * @property {string[]} [seasonColors] - array of color values for spring, summer, autumn, and winter
 * @property {sn.Configuration} excludeSources - the sources to exclude from the chart
 */

/**
 * An energy input and output chart designed to show consumption and generation data simultaneously
 * grouped by hours per day, per season.
 * 
 * You can use the {@code excludeSources} parameter to dynamically alter which sources are visible
 * in the chart. After changing the configuration call {@link sn.chart.seasonalHourOfDayLineChart#regenerate()}
 * to re-draw the chart.
 * 
 * Note that the global {@link sn.colorFn} function is used to map sources to colors, so that
 * must be set up previously.
 * 
 * @class
 * @param {string} containerSelector - the selector for the element to insert the chart into
 * @param {sn.chart.seasonalHourOfDayLineChartParameters} [chartConfig] - the chart parameters
 * @returns {sn.chart.seasonalHourOfDayLineChart}
 */
sn.chart.seasonalHourOfDayLineChart = function(containerSelector, chartConfig) {
	var that = {
		version : "1.0.0"
	};
	var sources = [];
	var config = (chartConfig || new sn.Configuration());
	
	// default to container's width, if we can
	var containerWidth = sn.pixelWidth(containerSelector);
	
	var p = (config.padding || [20, 0, 40, 30]),
		w = (config.width || containerWidth || 812) - p[1] - p[3],
		h = (config.height || 300) - p[0] - p[2],
    	x = d3.scale.linear().range([0, w]),
		y = d3.scale.linear().range([h, 0]);
	

	// x-domain is static as hours
	x.domain([0,23]);

	var yProps = {watts:1, wattHours:1};
	
	// one name for consumption, one for generation
	var layerNames = ['Consumption', 'Generation'];
	
	var sourceIdLayerNameMap = {Consumption : 'Consumption', Generation : 'Power'};
	
	var transitionMs = undefined;
	
	//var ruleOpacity = (parameters.ruleOpacity || 0.1);
	var vertRuleOpacity = undefined;
	
	// Array of string color values representing spring, summer, autumn, winter
	var seasonColors = undefined;
	
	// Boolean, true for northern hemisphere seasons, false for southern.
	var northernHemisphere = undefined;

	var svgRoot = undefined,
		svg = undefined,
		svgTickGroupX = undefined,
		svgSumLineGroup = undefined;
	
	var lineData = undefined;
	
	var consumptionLayerCount = 0;

	// Set y-axis  unit label
	// setup display units in kWh if domain range > 1000
	var displayFactor = 1;
	var displayFormatter = d3.format(',d');

	function parseConfiguration() {
		transitionMs = (config.transitionMs || 600);
		vertRuleOpacity = (config.vertRuleOpacity || 0.05);
		seasonColors = (config.seasonColors || ['#5c8726', '#e9a712', '#762123', '#80a3b7']); // Spring, Summer, Autumn, Winter
		northernHemisphere = (config.northernHemisphere === true ? true : false);
	}

	// create our SVG container structure now
	svgRoot = d3.select(containerSelector).select('svg');
	if ( svgRoot.empty() ) {
		svgRoot = d3.select(containerSelector).append('svg:svg')
			.attr('class', 'chart')
			.attr("width", w + p[1] + p[3])
			.attr("height", h + p[0] + p[2]);
	} else {
		svgRoot.selectAll('*').remove();
	}

	svg = svgRoot.append("g")
		.attr('class', 'data')
		.attr("transform", "translate(" + p[3] + "," + p[0] + ")");
	
	svgSumLineGroup = svgRoot.append("g")
		.attr('class', 'agg-sum')
		.attr("transform", "translate(" + p[3] + "," + p[0] + ")");

	svgTickGroupX = svgRoot.append("g")
		.attr("class", "ticks")
		.attr("transform", "translate(" + p[3] +"," +(h + p[0] + p[2]) +")");
	
	svgRoot.append("g")
		.attr("class", "vertrule")
		.attr("transform", "translate(" + p[3] + "," + p[0] + ")");

	svgRoot.append("g")
		.attr("class", "rule")
		.attr("transform", "translate(0," + p[0] + ")");
	
	function computeUnitsY() {
		var fmt;
		var maxY = d3.max(y.domain(), function(v) { return Math.abs(v); });
		if ( maxY >= 1000000 ) {
			displayFactor = 1000000;
			fmt = ',g';
		} else if ( maxY >= 1000 ) {
			displayFactor = 1000;
			fmt = ',g';
		} else {
			displayFactor = 1;
			fmt = ',d';
		}
		displayFormatter = d3.format(fmt);
	}
	
	function displayFormat(d) {
		return displayFormatter(d / displayFactor);
	}
	
	function seasonConsumptionPowerMap(rawData, outSourceArray) {
		// first empty out the source array, so we can re-build it
		outSourceArray.splice(0, outSourceArray.length);
		var sourceMap = {};
		var seasonMap = (function() {
			var result = {};
			var i = -1;
			while ( ++i < 4 ) {
				result[String(i)] = {'Consumption':[], 'Power':[]};
			}
			return result;
		})();
		var dataType = undefined;
		var dateKey = undefined;
		var dateMap = {Consumption:{}, Power:{}};
		var domainY = {};
		var i, len;
		var el, obj;
		var date = undefined;
		var prop = undefined;
		var hour, layerName;
		for ( i = 0, len = rawData.length; i < len; ++i ) {
			el = rawData[i];
			if ( sourceMap[el.sourceId] === undefined ) {
				outSourceArray.push(el.sourceId);
				sourceMap[el.sourceId] = 1;
			}
			
			if ( config.excludeSources !== undefined && config.excludeSources.enabled(el.sourceId) ) {
				continue;
			}

			dateKey = el.localDate +' ' +el.localTime;
			date = sn.dateTimeFormat.parse(dateKey);
			hour = date.getUTCHours();
			dataType = sourceIdLayerNameMap[el.sourceId];
			layerName = (dataType === 'Consumption' ? layerNames[0]: layerNames[1]);
			if ( dateMap[dataType][dateKey] === undefined ) {
				obj = {
						hour : hour,
						name : layerName,
				};
				// seasons are (northern hemi) [Spring, Summer, Autumn, Winter]
				// set the "season" to an index, 0-3, where 0 -> Dec,Jan,Feb, 1-> Mar,Apr,May, etc
				if ( date.getUTCMonth() < 2 || date.getUTCMonth() == 11 ) {
					obj.season = 3;
				} else if ( date.getUTCMonth() < 5 ) {
					obj.season = 0;
				} else if ( date.getUTCMonth() < 8 ) {
					obj.season = 1;
				} else {
					obj.season = 2;
				}
				
				dateMap[dataType][dateKey] = obj;
				seasonMap[String(obj.season)][dataType].push(obj);
			} else {
				obj = dateMap[dataType][dateKey];
			}
			
			for ( prop in yProps ) {
				if ( obj[prop] === undefined ) {
					obj[prop] = null;
				}
				if ( el[prop] >= 0 ) {
					// map Y value as negative if this source is a consumption source
					obj[prop] += (dataType === 'Consumption' ? -el[prop] : el[prop]);
				}
				
				// compute y extents while iterating through array
				if ( i === 0 ) {
					domainY[prop] = [obj[prop], obj[prop]];
				} else {
					if ( obj[prop] < domainY[prop][0] ) {
						domainY[prop][0] = obj[prop];
					}
					if ( obj[prop] > domainY[prop][1] ) {
						domainY[prop][1] = obj[prop];
					}
				}
			}
		}
		
		return {seasonMap: seasonMap, domainY:domainY};
	}

	function setup(rawData) {
		var layerMap = seasonConsumptionPowerMap(rawData, sources);
		var seasonMap = layerMap.seasonMap;
		
		// we will group all consumption sources together, and generation sources together as well
		var seasonOrder = ['1', '2', '3', '0']; // TODO: adjust based on current month
		lineData = [];
		seasonOrder.forEach(function(e) {
			lineData.push(seasonMap[e].Consumption);
			lineData.push(seasonMap[e].Power);
		});

		// y-domain has been computed for us by seasonMap()
		y.domain(layerMap.domainY.wattHours).nice();
		computeUnitsY();
	}
	
	function axisYTransform(d) {
		// align to half-pixels, to 1px line is aligned to pixels and crisp
		return "translate(0," + (Math.round(y(d) + 0.5) - 0.5) + ")"; 
	}

	function seasonColor(season) {
		if ( !northernHemisphere ) {
			season += 2;
		}
		return seasonColors[season % 4];
	}
	
	function axisXVertRule(d) {
		return (Math.round(x(d) + 0.5) - 0.5);
	}
	
	function adjustAxisX() {
		var ticks = x.ticks();
		adjustAxisXTicks(ticks);
		adjustAxisXRules(ticks);
	}
	
	function adjustAxisXTicks(ticks) {
		function tickText(d) {
			if ( d === 0 || d === 24 ) {
				return 'Mid';
			} else if ( d < 12 ) {
				return (String(d) + 'am');
			} else if ( d > 12 ) {
				return (String(d - 12) + 'pm');
			} else {
				return 'Noon';
			}
		}

		// Add hour labels, centered within associated band
		var labels = svgTickGroupX.selectAll("text").data(ticks);

		labels.transition().duration(transitionMs)
		  	.attr("x", axisXVertRule)
		  	.text(tickText);
		
		labels.enter().append("text")
			.attr("dy", "-0.5em") // needed so descenders not cut off
			.style("opacity", 1e-6)
			.attr("x", axisXVertRule)
		.transition().duration(transitionMs)
				.style("opacity", 1)
				.text(tickText)
				.each('end', function() {
						// remove the opacity style
						d3.select(this).style("opacity", null);
					});
		
		labels.exit().transition().duration(transitionMs)
			.style("opacity", 1e-6)
			.remove();
	}
	
	function adjustAxisXRules(vertRuleTicks) {
		var axisLines = svgRoot.select("g.vertrule").selectAll("line").data(vertRuleTicks);
		axisLines.transition().duration(transitionMs)
	  		.attr("x1", axisXVertRule)
	  		.attr("x2", axisXVertRule);
		
		axisLines.enter().append("line")
			.style("opacity", 1e-6)
			.attr("x1", axisXVertRule)
	  		.attr("x2", axisXVertRule)
	  		.attr("y1", 0)
	  		.attr("y2", h + 10)
		.transition().duration(transitionMs)
			.style("opacity", vertRuleOpacity)
			.each('end', function() {
				// remove the opacity style
				d3.select(this).style("opacity", null);
			});
		
		axisLines.exit().transition().duration(transitionMs)
			.style("opacity", 1e-6)
			.remove();
	}
	
	function adjustAxisY() {
		function ruleClass(d) {
			return (d === 0 ? 'origin' : 'm');
		}
		
		var axisLines = svgRoot.select("g.rule").selectAll("g").data(y.ticks(5));
		var axisLinesT = axisLines.transition().duration(transitionMs);
		axisLinesT.attr("transform", axisYTransform)
			.select("text")
				.text(displayFormat);
		axisLinesT.select("line")
				.attr('class', ruleClass);
		
	  	axisLines.exit().transition().duration(transitionMs)
	  			.style("opacity", 1e-6)
	  			.remove();
	  			
		var entered = axisLines.enter()
				.append("g")
				.style("opacity", 1e-6)
	  			.attr("transform", axisYTransform);
		entered.append("line")
				.attr("x2", w + p[3])
				.attr('x1', p[3])
				.attr('class', ruleClass);
		entered.append("text")
				.attr("x", p[3] - 10)
				.text(displayFormat);
		entered.transition().duration(transitionMs)
			.style("opacity", null);
	}

	var linePathGenerator = d3.svg.line()
		.interpolate("monotone")
		.x(function(d) { return x(d.hour); })
		.y(function(d) { return Math.round(y(d.wattHours) + 0.5) - 0.5; });

	function seasonalColor(d) {
		return seasonColor(d.season);
	}
	
	function seasonalLineColor(d) {
		if ( d === undefined || d.length < 1 ) {
			return '#ccc';
		}
		return seasonalColor(d[0]);
	}
	
	function redraw() {
		var path = svg.selectAll('path.line').data(lineData);
		
		path.transition().duration(transitionMs).delay(200)
				.attr('d', linePathGenerator)
				.style('stroke', seasonalLineColor);
		
		path.enter().append('path')
				.style('stroke', seasonalLineColor)
				.classed('line', true)
				.attr('d', linePathGenerator);
		
		path.exit().remove();
	}

	that.sources = sources;
	
	/**
	 * Get the x-axis domain (minimum and maximum dates).
	 * 
	 * @return {number[]} an array with the minimum and maximum values used in the x-axis of the chart
	 * @memberOf sn.chart.seasonalHourOfDayLineChart
	 */
	that.xDomain = function() { return x.domain(); };

	/**
	 * Get the y-axis domain (minimum and maximum values).
	 * 
	 * @return {number[]} an array with the minimum and maximum values used in the y-axis of the chart
	 * @memberOf sn.chart.seasonalHourOfDayLineChart
	 */
	that.yDomain = function() { return y.domain(); };
	
	/**
	 * Get the scaling factor the y-axis is using. By default this will return {@code 1}.
	 * After calling the {@link #load()} method, however, the chart may decide to scale
	 * the y-axis for clarity. You can call this method to find out the scaling factor the
	 * chart ended up using.
	 *  
	 * @returns the y-axis scale factor
	 * @memberOf sn.chart.seasonalHourOfDayLineChart
	 */
	that.yScale = function() { return displayFactor; };
	
	/**
	 * Get the current {@code aggregate} value in use.
	 * 
	 * @param {number} [value] the number of consumption sources to use
	 * @returns when used as a getter, the count number, otherwise this object
	 * @returns the {@code aggregate} value
	 * @memberOf sn.chart.seasonalHourOfDayLineChart
	 */
	that.aggregate = function(value) { 
		if ( !arguments.length ) return aggregateType;
		aggregateType = (value === 'Month' ? 'Month' : value === 'Day' ? 'Day' : 'Hour');
		return that;
	};
	
	/**
	 * Load data for the chart. The data is expected to be in a form suitable for
	 * passing to {@link sn.energyPerSourceArray}.
	 * 
	 * @param {Array} rawData - the raw chart data to load
	 * @returns this object
	 * @memberOf sn.chart.seasonalHourOfDayLineChart
	 */
	that.load = function(rawData) {
		parseConfiguration();
		setup(rawData);
		adjustAxisX();
		adjustAxisY();
		redraw();
		return that;
	};
	
	/**
	 * Regenerate the chart, using the current data. This can be called after disabling a
	 * source 
	 * 
	 * @returns this object
	 * @memberOf sn.chart.seasonalHourOfDayLineChart
	 */
	that.regenerate = function() {
		if ( layerGenerator === undefined ) {
			// did you call load() first?
			return that;
		}
		parseConfiguration();
		layers = layerGenerator();
		computeDomainY();
		adjustAxisX();
		adjustAxisY();
		redraw();
		return that;
	};
	
	/**
	 * Get or set the consumption source count. Set this to the number of sources that 
	 * are considered "consumption" and should show up <em>under</em> the y-axis origin.
	 * The sources are assumed to already be ordered with consumption before generation.
	 * 
	 * @param {number} [value] the number of consumption sources to use
	 * @returns when used as a getter, the count number, otherwise this object
	 * @memberOf sn.chart.seasonalHourOfDayLineChart
	 */
	that.consumptionSourceCount = function(value) {
		if ( !arguments.length ) return consumptionLayerCount;
		consumptionLayerCount = +value; // the + used to make sure we have a Number
		return that;
	};

	/**
	 * Get or set the animation transition time, in milliseconds.
	 * 
	 * @param {number} [value] the number of milliseconds to use
	 * @return when used as a getter, the millisecond value, otherwise this object
	 * @memberOf sn.chart.seasonalHourOfDayLineChart
	 */
	that.transitionMs = function(value) {
		if ( !arguments.length ) return transitionMs;
		transitionMs = +value; // the + used to make sure we have a Number
		return that;
	};
	
	/**
	 * Toggle showing the sum line, or get the current setting.
	 * 
	 * @param {boolean} [value] <em>true</em> to show the sum line, <em>false</em> to hide it
	 * @returns when used as a getter, the current setting
	 * @memberOf sn.chart.seasonalHourOfDayLineChart
	 */
	that.showSumLine = function(value) {
		if ( !arguments.length ) return !svgSumLineGroup.classed('off');
		svgSumLineGroup
			.style("opacity", (value ? 1e-6 : 1))
			.classed('off', false)
		.transition().duration(transitionMs)
			.style("opacity", (value ? 1 : 1e-6))
			.each('end', function() {
				// remove the opacity style
				d3.select(this)
					.style("opacity", null)
					.classed('off', !value);
			});
		return that;
	};
	
	/**
	 * Toggle between nothern/southern hemisphere seasons, or get the current setting.
	 * 
	 * @param {boolean} [value] <em>true</em> for northern hemisphere seasons, <em>false</em> for sothern hemisphere
	 * @returns when used as a getter, the current setting
	 * @memberOf sn.chart.seasonalHourOfDayLineChart
	 */
	that.northernHemisphere = function(value) {
		if ( !arguments.length ) return northernHemisphere;
		if ( value === northernHemisphere ) {
			return;
		}
		northernHemisphere = (value === true);
		// FIXME: adjust line colors
		/*
		svgAggBandGroup.selectAll("line").transition().duration(transitionMs)
			.style('stroke', seasonColor);
		aggGroup.selectAll("text").transition().duration(transitionMs)
			.style("fill", labelSeasonColors);
		*/
		return that;
	};
	
	/**
	 * Get or set the layer names.
	 * 
	 * The default value is: <code>{Consumption : 'Consumption', Generation : 'Generation'}</code>.
	 * 
	 * @param {Array} [value] an array with two values, the first the name for "consumption" data
	 *                        and the second for "generation" data
	 * @returns when used as a getter, the current array, otherwise this object
	 * @memberOf sn.chart.seasonalHourOfDayLineChart
	 */
	that.layerNames = function(value) {
		if ( !arguments.length ) return layerNames;
		layerNames = value;
		return that;
	};

	/**
	 * Get or set the mapping of source ID values to layer names.
	 * 
	 * The default value is: <code>{Consumption : 'Consumption', Generation : 'Generation'}</code>.
	 * 
	 * @param {Object} [value] object with source ID value property names and associated layer name values
	 * @returns when used as a getter, the current value, otherwise this object
	 * @memberOf sn.chart.seasonalHourOfDayLineChart
	 */
	that.sourceIdLayerNameMap = function(value) {
		if ( !arguments.length ) return sourceIdLayerNameMap;
		sourceIdLayerNameMap = value;
		return that;
	};

	parseConfiguration();
	return that;
};