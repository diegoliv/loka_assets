/*
 * GlobeEmbed
 * Embeddable Three.js globe with procedural grid, continent meshes, dots, and floating photos.
 * Usage:
 *   <script src="/path/to/globe-embed.js"></script>
 *   <script>
 *     GlobeEmbed.init({
 *       container: '#globe',
 *       photos: [
 *         { url: 'https://picsum.photos/320/200', lat: 51.5, lon: -0.1, size: 1.1 },
 *       ],
 *       regions: [
 *         { lat: 40, lon: -100, count: 20, spread: 10 },
 *       ]
 *     });
 *   </script>
 */
(function (global) {
  'use strict';

  var CDN = {
    three: 'https://unpkg.com/three@0.160.0/build/three.min.js',
    orbitControls: 'https://unpkg.com/three@0.160.0/examples/js/controls/OrbitControls.js'
  };

  var DEFAULTS = {
    radius: 1,
    grid: {
      latLines: 9,
      lonLines: 18,
      color: 0xcccccc,
      opacity: 0.9
    },
    continents: {
      color: 0xd9d9d9,
      opacity: 1
    },
    dots: {
      color: 0x1f6feb,
      size: 0.02
    },
    photos: {
      size: 1.0,
      elevation: 0.12,
      fadeSpeed: 0.08
    },
    autoRotate: true,
    autoRotateSpeed: 0.35,
    background: 0xffffff
  };

  function mergeOptions(target, source) {
    var output = Object.assign({}, target);
    if (!source) return output;
    Object.keys(source).forEach(function (key) {
      if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
        output[key] = mergeOptions(output[key] || {}, source[key]);
      } else {
        output[key] = source[key];
      }
    });
    return output;
  }

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.onload = function () {
        resolve();
      };
      script.onerror = function () {
        reject(new Error('Failed to load ' + src));
      };
      document.head.appendChild(script);
    });
  }

  function ensureThree() {
    if (global.THREE) {
      return Promise.resolve();
    }
    return loadScript(CDN.three);
  }

  function ensureOrbitControls() {
    if (global.THREE && global.THREE.OrbitControls) {
      return Promise.resolve();
    }
    return loadScript(CDN.orbitControls);
  }

  function resolveContainer(container) {
    if (typeof container === 'string') {
      return document.querySelector(container);
    }
    return container;
  }

  function latLonToVector3(lat, lon, radius) {
    var phi = (90 - lat) * (Math.PI / 180);
    var theta = (lon + 180) * (Math.PI / 180);
    var x = -radius * Math.sin(phi) * Math.cos(theta);
    var z = radius * Math.sin(phi) * Math.sin(theta);
    var y = radius * Math.cos(phi);
    return new global.THREE.Vector3(x, y, z);
  }

  function createGrid(radius, gridOptions) {
    var group = new global.THREE.Group();
    var material = new global.THREE.LineBasicMaterial({
      color: gridOptions.color,
      transparent: true,
      opacity: gridOptions.opacity
    });

    var latLines = gridOptions.latLines;
    var lonLines = gridOptions.lonLines;
    var segments = 128;

    for (var latIndex = 1; latIndex < latLines; latIndex += 1) {
      var lat = -90 + (180 / latLines) * latIndex;
      var geometry = new global.THREE.BufferGeometry();
      var points = [];
      for (var i = 0; i <= segments; i += 1) {
        var lon = -180 + (360 / segments) * i;
        points.push(latLonToVector3(lat, lon, radius));
      }
      geometry.setFromPoints(points);
      group.add(new global.THREE.Line(geometry, material));
    }

    for (var lonIndex = 0; lonIndex < lonLines; lonIndex += 1) {
      var lonFixed = -180 + (360 / lonLines) * lonIndex;
      var meridianGeometry = new global.THREE.BufferGeometry();
      var meridianPoints = [];
      for (var j = 0; j <= segments; j += 1) {
        var latStep = -90 + (180 / segments) * j;
        meridianPoints.push(latLonToVector3(latStep, lonFixed, radius));
      }
      meridianGeometry.setFromPoints(meridianPoints);
      group.add(new global.THREE.Line(meridianGeometry, material));
    }

    return group;
  }

  function triangulatePolygon(contour, holes) {
    var triangles = global.THREE.ShapeUtils.triangulateShape(contour, holes);
    var allPoints = contour.slice();
    holes.forEach(function (hole) {
      Array.prototype.push.apply(allPoints, hole);
    });
    return { triangles: triangles, points: allPoints };
  }

  function createContinents(geojson, radius, options) {
    var group = new global.THREE.Group();
    if (!geojson || !geojson.features) {
      return group;
    }

    var material = new global.THREE.MeshBasicMaterial({
      color: options.color,
      transparent: true,
      opacity: options.opacity,
      side: global.THREE.DoubleSide,
      depthWrite: false
    });

    geojson.features.forEach(function (feature) {
      if (!feature.geometry) return;
      var type = feature.geometry.type;
      var coords = feature.geometry.coordinates;
      var polygons = type === 'Polygon' ? [coords] : coords;

      polygons.forEach(function (polygon) {
        if (!polygon.length) return;
        var contour = polygon[0].map(function (pair) {
          return new global.THREE.Vector2(pair[0], pair[1]);
        });
        var holes = polygon.slice(1).map(function (hole) {
          return hole.map(function (pair) {
            return new global.THREE.Vector2(pair[0], pair[1]);
          });
        });

        if (contour.length < 3) return;

        var triangulation = triangulatePolygon(contour, holes);
        var vertices = [];
        triangulation.triangles.forEach(function (triangle) {
          triangle.forEach(function (index) {
            var point = triangulation.points[index];
            var vertex = latLonToVector3(point.y, point.x, radius);
            vertices.push(vertex.x, vertex.y, vertex.z);
          });
        });

        if (!vertices.length) return;

        var geometry = new global.THREE.BufferGeometry();
        geometry.setAttribute('position', new global.THREE.Float32BufferAttribute(vertices, 3));
        geometry.computeVertexNormals();

        var mesh = new global.THREE.Mesh(geometry, material);
        group.add(mesh);
      });
    });

    return group;
  }

  function createDots(regions, radius, dotOptions) {
    var group = new global.THREE.Group();
    if (!regions || !regions.length) return group;

    var geometry = new global.THREE.SphereGeometry(dotOptions.size, 8, 8);
    var material = new global.THREE.MeshBasicMaterial({ color: dotOptions.color });

    regions.forEach(function (region) {
      var count = region.count || 10;
      var spread = region.spread || 6;
      var mesh = new global.THREE.InstancedMesh(geometry, material, count);
      for (var i = 0; i < count; i += 1) {
        var lat = region.lat + (Math.random() - 0.5) * spread;
        var lon = region.lon + (Math.random() - 0.5) * spread;
        var position = latLonToVector3(lat, lon, radius + 0.01);
        var matrix = new global.THREE.Matrix4();
        matrix.setPosition(position);
        mesh.setMatrixAt(i, matrix);
      }
      group.add(mesh);
    });

    return group;
  }

  function createPhotos(photos, radius, options) {
    var group = new global.THREE.Group();
    var loader = new global.THREE.TextureLoader();
    loader.crossOrigin = 'anonymous';
    var items = [];

    (photos || []).forEach(function (photo) {
      var material = new global.THREE.SpriteMaterial({
        map: loader.load(photo.url),
        transparent: true,
        opacity: 1,
        depthTest: false
      });
      var sprite = new global.THREE.Sprite(material);
      var size = photo.size || options.size;
      sprite.scale.set(size, size * 0.66, 1);
      var position = latLonToVector3(photo.lat, photo.lon, radius + options.elevation);
      sprite.position.copy(position);
      sprite.userData = {
        targetOpacity: 1,
        fadeSpeed: options.fadeSpeed
      };
      group.add(sprite);
      items.push(sprite);
    });

    return { group: group, items: items };
  }

  var FALLBACK_GEOJSON = {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: { name: 'North America' },
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [-170, 15],
              [-140, 55],
              [-50, 70],
              [-50, 25],
              [-95, 15],
              [-170, 15]
            ]
          ]
        }
      },
      {
        type: 'Feature',
        properties: { name: 'South America' },
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [-85, 12],
              [-30, 10],
              [-35, -55],
              [-70, -55],
              [-85, 12]
            ]
          ]
        }
      },
      {
        type: 'Feature',
        properties: { name: 'Europe + Africa' },
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [-20, 60],
              [60, 70],
              [55, -35],
              [20, -35],
              [-20, 30],
              [-20, 60]
            ]
          ]
        }
      },
      {
        type: 'Feature',
        properties: { name: 'Asia + Australia' },
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [60, 60],
              [180, 70],
              [180, -50],
              [110, -45],
              [60, 10],
              [60, 60]
            ]
          ]
        }
      }
    ]
  };

  function GlobeEmbed() {
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.controls = null;
    this.container = null;
    this.animationId = null;
    this.photos = [];
    this.options = null;
  }

  GlobeEmbed.prototype.init = function (options) {
    var self = this;
    self.options = mergeOptions(DEFAULTS, options);
    self.container = resolveContainer(self.options.container || document.body);

    if (!self.container) {
      throw new Error('GlobeEmbed: container not found');
    }

    return ensureThree()
      .then(ensureOrbitControls)
      .then(function () {
        self.setupScene();
        self.animate();
        return self;
      });
  };

  GlobeEmbed.prototype.setupScene = function () {
    var self = this;
    var width = self.container.clientWidth || 800;
    var height = self.container.clientHeight || 600;

    self.scene = new global.THREE.Scene();
    self.scene.background = new global.THREE.Color(self.options.background);

    self.camera = new global.THREE.PerspectiveCamera(40, width / height, 0.1, 100);
    self.camera.position.set(0, 0, 3.2);

    self.renderer = new global.THREE.WebGLRenderer({ antialias: true, alpha: true });
    self.renderer.setSize(width, height);
    self.renderer.setPixelRatio(global.devicePixelRatio || 1);
    self.container.appendChild(self.renderer.domElement);

    var ambient = new global.THREE.AmbientLight(0xffffff, 0.8);
    self.scene.add(ambient);
    var directional = new global.THREE.DirectionalLight(0xffffff, 0.6);
    directional.position.set(2, 2, 2);
    self.scene.add(directional);

    self.controls = new global.THREE.OrbitControls(self.camera, self.renderer.domElement);
    self.controls.enableDamping = true;
    self.controls.enablePan = false;
    self.controls.autoRotate = !!self.options.autoRotate;
    self.controls.autoRotateSpeed = self.options.autoRotateSpeed;

    var globeGroup = new global.THREE.Group();

    var grid = createGrid(self.options.radius, self.options.grid);
    globeGroup.add(grid);

    var continents = createContinents(
      self.options.continentsGeoJSON || FALLBACK_GEOJSON,
      self.options.radius * 0.998,
      self.options.continents
    );
    globeGroup.add(continents);

    var dots = createDots(self.options.regions || [], self.options.radius, self.options.dots);
    globeGroup.add(dots);

    var photoData = createPhotos(self.options.photos || [], self.options.radius, self.options.photos);
    globeGroup.add(photoData.group);
    self.photos = photoData.items;

    self.scene.add(globeGroup);

    global.addEventListener('resize', function () {
      self.onResize();
    });
  };

  GlobeEmbed.prototype.onResize = function () {
    if (!this.container || !this.renderer || !this.camera) return;
    var width = this.container.clientWidth || 800;
    var height = this.container.clientHeight || 600;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  };

  GlobeEmbed.prototype.updatePhotos = function () {
    var self = this;
    if (!self.photos.length) return;
    var cameraDirection = self.camera.position.clone().normalize();

    self.photos.forEach(function (sprite) {
      var spriteDirection = sprite.position.clone().normalize();
      var isBehind = spriteDirection.dot(cameraDirection) < 0;
      sprite.userData.targetOpacity = isBehind ? 0 : 1;
      sprite.material.opacity +=
        (sprite.userData.targetOpacity - sprite.material.opacity) * sprite.userData.fadeSpeed;
    });
  };

  GlobeEmbed.prototype.animate = function () {
    var self = this;
    self.animationId = global.requestAnimationFrame(function () {
      self.animate();
    });
    if (self.controls) {
      self.controls.update();
    }
    self.updatePhotos();
    if (self.renderer && self.scene && self.camera) {
      self.renderer.render(self.scene, self.camera);
    }
  };

  GlobeEmbed.prototype.destroy = function () {
    if (this.animationId) {
      global.cancelAnimationFrame(this.animationId);
    }
    if (this.renderer && this.renderer.domElement && this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  };

  global.GlobeEmbed = new GlobeEmbed();
})(typeof window !== 'undefined' ? window : this);
