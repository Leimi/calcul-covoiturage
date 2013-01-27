(function() {

var Price = Backbone.Model.extend({
	defaults: {
		'people'  : 2,
		'liters'  : 6,
		'gazPrice': 1.5,
		'from'    : '',
		'to'      : '',
		'km'      : '',
		'cost'   : ''
	},

	initialize: function() {
		this.on('change', this.calculateCost, this);
	},

	calculateCost: function() {
		if (this.get('liters') > 0 && this.get('km')*1 > 0 && this.get('gazPrice') > 0 && this.get('people') > 0)
			this.set('cost', Math.round( (this.get('liters')/100*this.get('km'))*this.get('gazPrice')/this.get('people')*100)/100 );
		else
			this.set('cost', '');
	},

	/**
	 * balance les attributs du model dans un objet JSON tout simple,
	 * balance aussi le "cid" dans l'attribut "id" (permet une meilleure gestion des templates en mettant l'id unique du
	 * model dans les #id d'input pour éviter des doublons d'#id)
	 * @return {Object} objet json décrivant le model
	 */
	toJSON: function() {
		var obj = Backbone.Model.prototype.toJSON.call(this);
		obj.id = this.cid;
		return obj;
	}
});
var Form = Backbone.View.extend({
	template: _.template( $('#price-form-template').html() ),

	initialize: function() {
		var that = this;
		this.mapOverlays = [];
		this.render();
		this.geocoder = new google.maps.Geocoder();
		_.bindAll(this);
		this.$('input[name=from]').on('focus', this.changeAdressWithUserPos);

		var distCalcTimeout = null;
		this.priceTimeout = null;
		this.$('input[name=from], input[name=to]').on('focus blur', this.calculateDistance);
		this.$('input[name=from], input[name=to]').on('keydown', function() {
			clearTimeout(distCalcTimeout);
			distCalcTimeout = setTimeout(function() {
				that.calculateDistance();
			}, 1500);
		});
		this.$('input[name=km-twice]').on('change', this.updateKm);
		this.model.on('change:cost', this.renderPrice);
		this.updateGazTypes();

		this.initFormEvents();
	},

	initFormEvents: function() {
		this.$('input, select').on('change input', this.updateModel);
		this.model.on('change', this.updateView);
	},

	render: function() {
		this.$el.html(this.template(this.model.toJSON()));
		this.renderPrice({anim: false});
		this.updateMap();
		return this;
	},

	updateView: function() {
		_(this.model.changedAttributes()).each(function(value, key) {
			console.log('key:', key, 'value:', value);
			this.$('input[name="' + key + '"][value!="' + value + '"][type!="radio"]').val(value);
			this.$('input[name="' + key + '"][value="' + value + '"][type="radio"]').attr('checked', 'checked');
			this.$('select[name="' + key + '"] option[value="' + value + '"]').attr('checked', 'checked');
		});
	},

	updateModel: function(event) {
		var $input = $(event.currentTarget);
		console.log('updateModel', $input, $input.val());
		if (this.model.has($input.attr('name')))
			this.model.set($input.attr('name'), _.escape($input.val()));
	},

	updateGazTypes: function() {
		var _this = this,
			localData = localStorage.getItem('essence'),
			today = Math.round(new Date().getTime()/1000/60/60/24);
		function populate(data) {
			var items = [],
				defVal = '';
			_(data).each(function(price, name) {
				price = price.toFixed(2);
				if (name !== "days") {
					items.push('<option value="' + price + '">' + name + '</option>');
					if (name == "SP95") defVal = price;
				}
			});
			_this.$("select[name=gazPrice]").append(items.join('')).val(defVal).trigger('change');
		}
		if (localData !== null)
			localData = JSON.parse(localData);
		if (localData && localData.days && today - localData.days <= 7)
			populate(localData);
		else {
			$.getJSON('php/essence.php', function(data) {
				populate(data);
				localData = data;
				localData.days = today;
				localStorage.setItem('essence', JSON.stringify(localData));
			});
		}
	},

	updateKm: function() {
		var $input = this.$('input[name=km-twice]'),
			$label = $input.closest('label');
		if ($input.is(':checked')) {
			$label.addClass('checked');
		}
		else {
			$label.removeClass('checked');
		}
		this.calculateDistance();
	},

	changeAdressWithUserPos: function() {
		console.log('changeAdressWithUserPos');
		var _this = this;
		if (!("geolocation" in navigator) || $('input[name=from]').val().length) return;
		navigator.geolocation.getCurrentPosition(function(pos) {
			var latLng = new google.maps.LatLng(pos.coords.latitude, pos.coords.longitude);
			_this.geocoder.geocode({'latLng': latLng}, function(results, status) {
				if (status == google.maps.GeocoderStatus.OK && results[0]) {
					_this.$('input[name=from]').val(results[0].formatted_address).trigger('change');
				}
			});
		});
	},

	calculateDistance: function() {
		if (!this.$('input[name=from]').val().length || !this.$('input[name=to]').val().length) return;
		var distanceMatrix = new google.maps.DistanceMatrixService(),
			fromLatLng,
			toLatLng,
			_this = this;
		this.geocoder.geocode({'address': this.$('input[name=from]').val()}, function(response, status) {
			if (status == google.maps.GeocoderStatus.OK) {
				fromLatLng = response[0].geometry.location;
				_this.from = fromLatLng;
				_this.geocoder.geocode({'address': _this.$('input[name=to]').val()}, function(response, status) {
					if (status == google.maps.GeocoderStatus.OK) {
						toLatLng = response[0].geometry.location;
						_this.to = toLatLng;
						distanceMatrix.getDistanceMatrix(
							{ origins: [fromLatLng], destinations: [toLatLng], travelMode: google.maps.TravelMode.DRIVING },
							function(response, status) {
								var el = response.rows[0].elements[0];
								if (el.status == "OK") {
									var times = _this.$('input[name=km-twice]').is(':checked') ? 2 : 1;
									_this.$('input[name=km]').val(Math.round(el.distance.value/1000*100)/100*times).trigger('change');
								}
							}
						);
						_this.updateMap();
					}
				});
			}
		});
	},

	renderPrice: function(opts) {
		clearTimeout(this.priceTimeout);
		if (!(opts && opts.anim)) opts = { anim: true };
		opts = { anim: true };
		var $results = this.$('.results');
		if (this.model.get('cost') !== '') {
			this.$('.cost').html(this.model.get('cost'));
			$results.removeClass('hidden');
			if (opts.anim) {
				this.priceTimeout = setTimeout(function() {
					$results.removeClass('not');
				}, 100);
			} else {
				$results.removeClass('not');
			}
		}
		else {
			this.$('.cost').html('');
			$results.addClass('not');
			if (opts.anim) {
				this.priceTimeout = setTimeout(function() {
					$results.addClass('hidden');
				}, 500);
			} else {
				$results.addClass('hidden');
			}
		}
	},

	updateMap: function() {
		var opts = {
			center: new google.maps.LatLng(47, 2),
			zoom: 5,
			mapTypeId: google.maps.MapTypeId.ROADMAP
		};
		if (!this.map)
			this.map = new google.maps.Map(this.$('.map').get(0), opts);
		while(this.mapOverlays[0]){
			this.mapOverlays.pop().setMap(null);
		}
		if (this.from || this.to) {
			var marker = null;
			this.$('.map').removeClass('inactive');
			if (this.from) {
				marker = new google.maps.Marker({
					map: this.map,
					position: this.from
				});
				this.mapOverlays.push(marker);
			}
			if (this.to) {
				marker = new google.maps.Marker({
					map: this.map,
					position: this.to
				});
				this.mapOverlays.push(marker);
			}
		} else {
			this.$('.map').addClass('inactive');
		}
	}
});

var iHasRangeInput = function() {
	var inputElem  = document.createElement('input'),
		smile = ':)',
		docElement = document.documentElement,
		inputElemType = 'range',
		available;
	inputElem.setAttribute('type', inputElemType);
	available = inputElem.type !== 'text';
	inputElem.value         = smile;
	inputElem.style.cssText = 'position:absolute;visibility:hidden;';
	if ( /^range$/.test(inputElemType) && inputElem.style.WebkitAppearance !== undefined ) {
		docElement.appendChild(inputElem);
		defaultView = document.defaultView;
		available = defaultView.getComputedStyle &&
			defaultView.getComputedStyle(inputElem, null).WebkitAppearance !== 'textfield' &&
			(inputElem.offsetHeight !== 0);
		docElement.removeChild(inputElem);
	}
	return !!available;
};

yepnope({
	test : iHasRangeInput(),
	nope : ['css/fd-slider.css', 'js/fd-slider.js'],
	callback: function(id, testResult) {
		if("fdSlider" in window && typeof (fdSlider.onDomReady) != "undefined") {
			try { fdSlider.onDomReady(); } catch(err) {}
		}
	}
});

window.price = new Price();
window.form = new Form({
	model: price,
	el: '#form'
});

}());