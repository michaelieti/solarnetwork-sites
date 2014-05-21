/**
 * @require d3 3.0
 * @require queue 1.0
 * @require solarnetwork-d3 0.0.3
 */

if ( sn === undefined ) {
	sn = { chart: {} };
} else if ( sn.chart === undefined ) {
	sn.chart = {};
}

/**
 * @typedef sn.chart.energyIOAreaChartParameters
 * @type {object}
 * @property {number} [width=812] - desired width, in pixels, of the chart
 * @property {number} [height=300] - desired height, in pixels, of the chart
 * @property {number[]} [padding=[10, 0, 20, 30]] - padding to inset the chart by, in top, right, bottom, left order
 */

/**
 * An energy input and output chart designed to show consumption and generation data simultaneously.
 * 
 * @class
 * @param {string} containerSelector - the selector for the element to insert the chart into
 * @param {sn.chart.energyIOAreaChartParameters} [chartParams] - the chart parameters
 * @returns {sn.chart.energyIOAreaChart}
 */
sn.chart.energyIOAreaChart = function(containerSelector, chartParams) {
	var that = {
		version : "1.0.0"
	};
	var sources = [];
	var parameters = (chartParams || {});
	
	// default to container's width, if we can
	var containerWidth = sn.pixelWidth(containerSelector);
	
	var p = (parameters.padding || [10, 0, 20, 30]),
		w = (parameters.width || containerWidth || 812) - p[1] - p[3],
		h = (parameters.height || 300) - p[0] - p[2],
    	x = d3.time.scale().range([0, w]),
		y = d3.scale.linear().range([h, 0]),
		format = d3.time.format("%H");

	var svgRoot = undefined,
		svg = undefined,
		clipId = undefined;
	
	// our layer data, and generator function
	var layerGenerator = undefined;
	var layers = undefined;
	
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
		computeUnitsY();
	}
	
	// Set y-axis  unit label
	// setup display units in kW if domain range > 1000
	var displayFactor = 1;
	var displayFormatter = d3.format(',d');
	function computeUnitsY() {
		var fmt;
		var domain = y.domain();
		var maxY = domain[domain.length - 1];
		if ( maxY >= 100000 ) {
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

	function setup(rawData) {
		// turn filteredData object into proper array, sorted by date
		var dataArray = sn.powerPerSourceArray(rawData, sources);
		sn.log('Available area sources: {0}', sources);

		// Transpose the data into watt layers by source, e.g.
		// [ [{x:0,y:0},{x:1,y:1}...], ... ]
		layerGenerator = sn.powerPerSourceStackedLayerGenerator(sources, 'watts')
			.excludeSources(sn.runtime.excludeSources)
			.offset(sn.env.wiggle === 'true' ? 'wiggle' : 'zero')
			.data(dataArray);
		layers = layerGenerator();

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
		clipId = 'Clip' +sn.runtime.globalCounter.incrementAndGet();
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
				.attr("y", h + 10)
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
				.attr("x", p[3] - 10)
				.text(displayFormat);
		entered.transition().duration(sn.config.defaultTransitionMs)
				.style("opacity", 1);
	}
	
	that.sources = sources;
	that.xDomain = function() { return x.domain(); };
	that.yDomain = function() { return y.domain(); };
	that.yScale = function() { return displayFactor; };
	that.load = function(rawData) {
		setup(rawData);
		redraw();
		adjustAxisX();
		adjustAxisY();
	};
	that.regenerate = function() {
		if ( layerGenerator === undefined ) {
			// did you call load() first?
			return;
		}
		layers = layerGenerator();
		computeDomainY();
		svg.selectAll("g.source").data(layers);
		redraw();
		adjustAxisY();
	};

	return that;
};