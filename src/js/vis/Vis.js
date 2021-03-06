vde.Vis = (function() {
  var vis = {

    properties: {
      width: 500,
      height: 375,
      _autopad: true,
      padding: {top:30, left:30, right:30, bottom:30} //default values when _autopad is disabled 
    },

    _data:   {},
    pipelines: {},
    groups: {},
    groupOrder: [],

    view: null,
    evtHandlers: {}
  };

  vis.data = function(name, data, type) {
    if(!data) return vis._data[name];

    if(vg.isObject(data)) {
      vis._data[name] = {
        name: name,
        values: data
      };
    }

    if(vg.isString(data)) {
      vis._data[name] = {
        name: name,
        url: data,
        format: vg.isString(type) ? {type: type} : type
      };

      var dataModel = vg.parse.data([vis._data[name]], function() {
        vis._data[name].values = dataModel.load[name];
      });
    }
  };

  vis.addEventListener = function(type, caller, handler) {
    vis.evtHandlers[type] || (vis.evtHandlers[type] = []);
    vis.evtHandlers[type].push({
      caller: caller,
      handler: handler
    });
  };

  vis.removeEventListener = function(type, caller) {
    var del = [], regd = (vis.evtHandlers[type] || []);
    regd.forEach(function(r, i) {
      if(r.caller == caller) del.push(i);
    });

    del.forEach(function(d) { regd.splice(d, 1); })
  };

  vis.parse = function(inlinedValues) {
    var deferred = vde.iVis.ngQ().defer(), props = vis.properties;
    var spec = {
      width: props.width,
      height: props.height,
      padding: props._autopad ? 'auto' : props.padding,
      data: [],
      scales: [],
      marks: []
    };

    vde.Vis.callback.run('vis.pre_spec', this, {spec: spec});

    inlinedValues = (inlinedValues == null || inlinedValues == true);
    rawSources = {};

    var addRawSource = function(src) {
      if(!src || rawSources[src]) return;

      var data = vg.duplicate(vis._data[src]);
      if(data.url)        // Inline values to deal with x-site restrictions
        delete data[inlinedValues ? 'url' : 'values'];

      spec.data.push(data);
      rawSources[src] = 1;
    };

    // Scales are defined within groups. No global scales.
    for(var p in vis.pipelines) {
      var pl = vis.pipelines[p];
      // Clear scales hasAxis flag.
      for(var s in pl.scales) {
        pl.scales[s].hasAxis = false;
        pl.scales[s].used = false;
      }

      addRawSource(pl.source);
      spec.data = spec.data.concat(pl.spec());
    }

    // Reverse order of groups: earlier in groupOrder => closer to front
    vis.groupOrder.forEach(function(g) { spec.marks.unshift(vis.groups[g].spec()); });

    vde.Vis.callback.run('vis.post_spec', this, {spec: spec});

    // Now that the spec has been generated, bookkeep to clean up unused scales
    for(var p in vis.pipelines) vis.pipelines[p].bookkeep();
    for(var g in vis.groups) vis.groups[g].bookkeep();

    vg.parse.spec(spec, function(chart) {
      d3.select('#vis').selectAll('*').remove();
      (vde.Vis.view = chart({ el: '#vis' })).update();

      for(var g in vis.groups) vis.groups[g].annotate();

      for(var type in vis.evtHandlers)
        vis.evtHandlers[type].forEach(function(h, i) {
          if(type.indexOf('key') != -1) d3.select('body').on(type + '.' + i, h.handler);
          else vde.Vis.view.on(type, h.handler);
        });

      var newMark = function() {
        if(!vde.iVis.dragging || !vde.iVis.newMark) return;
        vde.iVis.addMark();
      };

      vde.Vis.view
        .on('mousedown', function(e, i) {
          if(!vde.iVis.dragging) vde.iVis.dragging = {item: i, prev: [e.pageX, e.pageY]};
        })
        .on('mouseup', function() { newMark(); vde.iVis.dragging = null; })
        .on('mouseover', function(e, i) {
          var d = vde.iVis.dragging, m = i.mark.def.vdeMdl;
          if(!d || !$(d).html() || !m) return;
          if(m == vde.iVis.activeMark && vde.iVis.activeItem == i.vdeKey) return;
          if(m.type == 'group') return;

          vde.iVis.markTimeout = window.setTimeout(function() {
            var scope = vde.iVis.ngScope();
            scope.$apply(function() { scope.toggleVisual(m, i.vdeKey || i.key || 0, true); });

            var isMark = $(d).hasClass('mark');
            if(isMark && vde.iVis.newMark.canConnect) m.connectionTargets();
            else if(!isMark) m.propertyTargets();
          }, vde.iVis.timeout);
        })
        .on('mouseout', function() { window.clearTimeout(vde.iVis.markTimeout); });

      d3.select('#vis canvas').on('mouseup.vis', newMark);

      // If the vis gets reparsed, reparse the interactive layer too to update any
      // visible handlers, etc.
      vde.iVis.parse().then(function(ispec) { deferred.resolve(spec); });
    });

    return deferred.promise;
  };

  vis.export = function(data) {
    var ex = {
      groups: {},
      groupOrder: vg.duplicate(vis.groupOrder),
      pipelines: vg.duplicate(vis.pipelines),
      properties: vg.duplicate(vis.properties),
      _data: data ? vg.duplicate(vis._data) : {}
    };

    for(var g in vis.groups) ex.groups[g] = vg.duplicate(vis.groups[g].export());
    return ex;
  };

  vis.import = function(spec) {
    var scales = {}, deferred = vde.iVis.ngQ().defer();

    var className = function(n) {
      return n.charAt(0).toUpperCase() + n.slice(1)
    };

    var importProperties = function(a, b) {
      for(var k in b) {
        if(vg.isObject(b[k])) {
          if(!vg.isObject(a[k])) {
            if(b[k].hasOwnProperty('accessor') || k == 'field') a[k] = new vde.Vis.Field('');
            else if(k == 'scale' || b[k].hasOwnProperty('domainTypes')) a[k] = scales[b[k].name];
            else if(vg.isArray(b[k])) a[k] = [];
            else a[k] = {};
          }
          importProperties(a[k], b[k]);
        } else {
          a[k] = b[k];
        }
      }
    };

    var importGroups = function(g) {
      var group = new vde.Vis.marks.Group(g.name, g.layerName, g.groupName);
      group.import(g);

      for(var scaleName in g.scales) {
        group.scales[scaleName] = scales[scaleName];
      }

      for(var axisName in g.axes) {
        var a = g.axes[axisName];
        var axis = new vde.Vis.Axis(axisName, a.layerName, a.groupName);
        axis.init();
        axis.import(a);
      };

      for(var markName in g.marks) {
        var m = g.marks[markName];
        if(m.type == 'group') importGroups(m);
        else {
          var mark = new vde.Vis.marks[className(m.type)](markName, m.layerName, m.groupName);
          mark.init();
          mark.import(m);
        }
      };

      importProperties(group, g);
    };

    // Clear existing pipelines and groups. We want to do this in two
    // apply cycles because pipeline/group names may be the same, and
    // angular may not pick up the updates otherwise.
    for(var p in vis.pipelines) { delete vis.pipelines[p]; }
    for(var g in vis.groups) { delete vis.groups[g]; }
    for(var c in vis.callback._registered) { delete vis.callback._registered[c]; }
    vde.Vis.groupOrder.length = 0;
    vde.iVis.activeMark = null;

    for(var pipelineName in spec.pipelines) {
      var p = spec.pipelines[pipelineName];
      var pipeline = new vde.Vis.Pipeline(p.source);

      for(var scaleName in p.scales) {
        var scale = new vde.Vis.Scale(scaleName, pipeline, {});
        scales[scaleName] = scale; // Keep around for groups
      }

      p.transforms.forEach(function(t) {
        var transform = new vde.Vis.transforms[className(t.type)](pipelineName);
        pipeline.transforms.push(transform);
      });

      importProperties(pipeline, p);
    };

    for(var layerName in spec.groups) {
      importGroups(spec.groups[layerName]);
    }

    importProperties(vis.properties, spec.properties);
    if(spec._data) importProperties(vis._data, spec._data);
    importProperties(vis.groupOrder, spec.groupOrder);

    vis.parse().then(function(spec) { deferred.resolve(spec); });

    return deferred.promise;
  };

  vis.parseProperty = function(props, prop) {
    var p = props[prop], parsed = {};
    if(!vg.isObject(p)) return;
    if(p.disabled) return;

    for(var k in p) {
      if(p[k] == undefined) return;

      if(k == 'scale') { parsed[k] = p[k].name; p[k].used = true; }
      else if(k == 'field') parsed[k] = p[k].spec();
      else {
        var value = (!isNaN(+p[k])) ? +p[k] : p[k];
        if(value == 'auto') {   // If the value is auto, rangeband
          if(p.scale.type() == 'ordinal') {
            parsed.band = true;
            parsed.offset = -1;
          } else parsed[k] = 0; // If we don't have an ordinal scale, just set value:0
        } else {
          parsed[k] = value;
        }
      }
    };

    return parsed;
  };

  vis.codename = function(count) {
    return count+1;
  };

  return vis;
})();
