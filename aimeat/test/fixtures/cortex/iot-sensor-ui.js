(function(AIMEAT) {
  'use strict';

  var METRIC_DEFAULTS = {
    temperature: { min: -20, max: 60, unit: 'celsius', format: function(v) { return v.toFixed(1) + ' \u00b0C'; } },
    humidity:    { min: 0,   max: 100, unit: 'percent', format: function(v) { return v.toFixed(0) + ' %'; } },
    pressure:    { min: 950, max: 1050, unit: 'hpa',    format: function(v) { return v.toFixed(0) + ' hPa'; } },
    co2:         { min: 0,   max: 5000, unit: 'ppm',    format: function(v) { return v.toFixed(0) + ' ppm'; } },
    pm25:        { min: 0,   max: 500,  unit: 'ug_m3',  format: function(v) { return v.toFixed(1) + ' \u00b5g/m\u00b3'; } },
    noise:       { min: 0,   max: 130,  unit: 'db',     format: function(v) { return v.toFixed(0) + ' dB'; } },
    light:       { min: 0,   max: 100000, unit: 'lux',  format: function(v) { return v.toFixed(0) + ' lx'; } },
  };

  /**
   * SensorGauge — renders a visual gauge for a single sensor reading.
   * @param {object} props
   * @param {string} props.metric      — metric type (temperature, humidity, etc.)
   * @param {number} props.value       — current reading value
   * @param {string} [props.unit]      — override unit label
   * @param {number} [props.min]       — minimum scale value
   * @param {number} [props.max]       — maximum scale value
   * @param {object} [props.thresholds] — {warning: number, critical: number}
   * @returns {HTMLElement}
   */
  function SensorGauge(props) {
    var defaults = METRIC_DEFAULTS[props.metric] || { min: 0, max: 100, format: function(v) { return String(v); } };
    var min = props.min != null ? props.min : defaults.min;
    var max = props.max != null ? props.max : defaults.max;
    var value = props.value != null ? props.value : 0;
    var pct = Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100));

    var el = document.createElement('div');
    el.className = 'aimeat-sensor-gauge';
    el.setAttribute('data-metric', props.metric || '');

    var label = document.createElement('div');
    label.className = 'gauge-label';
    label.textContent = (props.metric || 'unknown').replace(/_/g, ' ');
    el.appendChild(label);

    var track = document.createElement('div');
    track.className = 'gauge-track';
    var fill = document.createElement('div');
    fill.className = 'gauge-fill';
    fill.style.width = pct + '%';

    // Apply threshold colouring
    if (props.thresholds) {
      if (value >= props.thresholds.critical) {
        fill.classList.add('gauge-critical');
      } else if (value >= props.thresholds.warning) {
        fill.classList.add('gauge-warning');
      }
    }
    track.appendChild(fill);
    el.appendChild(track);

    var reading = document.createElement('div');
    reading.className = 'gauge-reading';
    reading.textContent = defaults.format(value);
    el.appendChild(reading);

    return el;
  }

  /**
   * DeviceStatusBadge — renders an inline status badge for a sensor device.
   * @param {object} props
   * @param {object} props.device — device object with {name, status, battery_pct?, last_seen?}
   * @returns {HTMLElement}
   */
  function DeviceStatusBadge(props) {
    var device = props.device || {};
    var el = document.createElement('span');
    el.className = 'aimeat-device-badge';
    var status = device.status || 'offline';
    el.classList.add('badge-' + status);

    var dot = document.createElement('span');
    dot.className = 'badge-dot';
    el.appendChild(dot);

    var name = document.createElement('span');
    name.className = 'badge-name';
    name.textContent = device.name || device.device_id || 'Unknown';
    el.appendChild(name);

    if (device.battery_pct != null) {
      var batt = document.createElement('span');
      batt.className = 'badge-battery';
      batt.textContent = device.battery_pct + '%';
      if (device.battery_pct < 20) batt.classList.add('battery-low');
      el.appendChild(batt);
    }

    return el;
  }

  /**
   * AlertBanner — renders a dismissible list of sensor alerts.
   * @param {object} props
   * @param {Array} props.alerts    — array of {level, message, device_id?, timestamp?}
   * @param {function} [props.onDismiss] — callback(alertIndex) when an alert is dismissed
   * @returns {HTMLElement}
   */
  function AlertBanner(props) {
    var alerts = props.alerts || [];
    var container = document.createElement('div');
    container.className = 'aimeat-alert-banner';

    alerts.forEach(function(alert, idx) {
      var row = document.createElement('div');
      row.className = 'alert-row alert-' + (alert.level || 'info');

      var icon = document.createElement('span');
      icon.className = 'alert-icon';
      icon.textContent = alert.level === 'critical' ? '!' : alert.level === 'warning' ? '\u26a0' : '\u2139';
      row.appendChild(icon);

      var msg = document.createElement('span');
      msg.className = 'alert-message';
      msg.textContent = alert.message || '';
      row.appendChild(msg);

      if (typeof props.onDismiss === 'function') {
        var dismiss = document.createElement('button');
        dismiss.className = 'alert-dismiss';
        dismiss.textContent = '\u00d7';
        dismiss.addEventListener('click', function() { props.onDismiss(idx); });
        row.appendChild(dismiss);
      }

      container.appendChild(row);
    });

    return container;
  }

  AIMEAT.register('iot-sensor-ui', { SensorGauge: SensorGauge, DeviceStatusBadge: DeviceStatusBadge, AlertBanner: AlertBanner });
})(window.AIMEAT || (window.AIMEAT = {}));
