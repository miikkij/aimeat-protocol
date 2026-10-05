// GENERATED FILE — do not edit directly. Source: src/static/sdk-libs/validate/ (+ _core/).
// Rebuild: pnpm build:sdk  ·  Served at /v1/libs/aimeat-validate.js (with a per-node config prelude).
"use strict";
(() => {
  var __defProp = Object.defineProperty;
  var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
  var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);

  // src/static/sdk-libs/_core/namespace.js
  function namespace() {
    if (!window.AIMEAT) window.AIMEAT = {};
    return window.AIMEAT;
  }
  function attach(key, value) {
    const ns = namespace();
    ns[key] = value;
    return ns;
  }

  // node_modules/.pnpm/@cfworker+json-schema@4.1.1/node_modules/@cfworker/json-schema/dist/esm/deep-compare-strict.js
  function deepCompareStrict(a, b) {
    const typeofa = typeof a;
    if (typeofa !== typeof b) {
      return false;
    }
    if (Array.isArray(a)) {
      if (!Array.isArray(b)) {
        return false;
      }
      const length = a.length;
      if (length !== b.length) {
        return false;
      }
      for (let i = 0; i < length; i++) {
        if (!deepCompareStrict(a[i], b[i])) {
          return false;
        }
      }
      return true;
    }
    if (typeofa === "object") {
      if (!a || !b) {
        return a === b;
      }
      const aKeys = Object.keys(a);
      const bKeys = Object.keys(b);
      const length = aKeys.length;
      if (length !== bKeys.length) {
        return false;
      }
      for (const k of aKeys) {
        if (!deepCompareStrict(a[k], b[k])) {
          return false;
        }
      }
      return true;
    }
    return a === b;
  }

  // node_modules/.pnpm/@cfworker+json-schema@4.1.1/node_modules/@cfworker/json-schema/dist/esm/pointer.js
  function encodePointer(p) {
    return encodeURI(escapePointer(p));
  }
  function escapePointer(p) {
    return p.replace(/~/g, "~0").replace(/\//g, "~1");
  }

  // node_modules/.pnpm/@cfworker+json-schema@4.1.1/node_modules/@cfworker/json-schema/dist/esm/dereference.js
  var schemaArrayKeyword = {
    prefixItems: true,
    items: true,
    allOf: true,
    anyOf: true,
    oneOf: true
  };
  var schemaMapKeyword = {
    $defs: true,
    definitions: true,
    properties: true,
    patternProperties: true,
    dependentSchemas: true
  };
  var ignoredKeyword = {
    id: true,
    $id: true,
    $ref: true,
    $schema: true,
    $anchor: true,
    $vocabulary: true,
    $comment: true,
    default: true,
    enum: true,
    const: true,
    required: true,
    type: true,
    maximum: true,
    minimum: true,
    exclusiveMaximum: true,
    exclusiveMinimum: true,
    multipleOf: true,
    maxLength: true,
    minLength: true,
    pattern: true,
    format: true,
    maxItems: true,
    minItems: true,
    uniqueItems: true,
    maxProperties: true,
    minProperties: true
  };
  var initialBaseURI = typeof self !== "undefined" && self.location && self.location.origin !== "null" ? new URL(self.location.origin + self.location.pathname + location.search) : new URL("https://github.com/cfworker");
  function dereference(schema, lookup = /* @__PURE__ */ Object.create(null), baseURI = initialBaseURI, basePointer = "") {
    if (schema && typeof schema === "object" && !Array.isArray(schema)) {
      const id = schema.$id || schema.id;
      if (id) {
        const url = new URL(id, baseURI.href);
        if (url.hash.length > 1) {
          lookup[url.href] = schema;
        } else {
          url.hash = "";
          if (basePointer === "") {
            baseURI = url;
          } else {
            dereference(schema, lookup, baseURI);
          }
        }
      }
    } else if (schema !== true && schema !== false) {
      return lookup;
    }
    const schemaURI = baseURI.href + (basePointer ? "#" + basePointer : "");
    if (lookup[schemaURI] !== void 0) {
      throw new Error(`Duplicate schema URI "${schemaURI}".`);
    }
    lookup[schemaURI] = schema;
    if (schema === true || schema === false) {
      return lookup;
    }
    if (schema.__absolute_uri__ === void 0) {
      Object.defineProperty(schema, "__absolute_uri__", {
        enumerable: false,
        value: schemaURI
      });
    }
    if (schema.$ref && schema.__absolute_ref__ === void 0) {
      const url = new URL(schema.$ref, baseURI.href);
      url.hash = url.hash;
      Object.defineProperty(schema, "__absolute_ref__", {
        enumerable: false,
        value: url.href
      });
    }
    if (schema.$recursiveRef && schema.__absolute_recursive_ref__ === void 0) {
      const url = new URL(schema.$recursiveRef, baseURI.href);
      url.hash = url.hash;
      Object.defineProperty(schema, "__absolute_recursive_ref__", {
        enumerable: false,
        value: url.href
      });
    }
    if (schema.$anchor) {
      const url = new URL("#" + schema.$anchor, baseURI.href);
      lookup[url.href] = schema;
    }
    for (let key in schema) {
      if (ignoredKeyword[key]) {
        continue;
      }
      const keyBase = `${basePointer}/${encodePointer(key)}`;
      const subSchema = schema[key];
      if (Array.isArray(subSchema)) {
        if (schemaArrayKeyword[key]) {
          const length = subSchema.length;
          for (let i = 0; i < length; i++) {
            dereference(subSchema[i], lookup, baseURI, `${keyBase}/${i}`);
          }
        }
      } else if (schemaMapKeyword[key]) {
        for (let subKey in subSchema) {
          dereference(subSchema[subKey], lookup, baseURI, `${keyBase}/${encodePointer(subKey)}`);
        }
      } else {
        dereference(subSchema, lookup, baseURI, keyBase);
      }
    }
    return lookup;
  }

  // node_modules/.pnpm/@cfworker+json-schema@4.1.1/node_modules/@cfworker/json-schema/dist/esm/format.js
  var DATE = /^(\d\d\d\d)-(\d\d)-(\d\d)$/;
  var DAYS = [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  var TIME = /^(\d\d):(\d\d):(\d\d)(\.\d+)?(z|[+-]\d\d(?::?\d\d)?)?$/i;
  var HOSTNAME = /^(?=.{1,253}\.?$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[-0-9a-z]{0,61}[0-9a-z])?)*\.?$/i;
  var URIREF = /^(?:[a-z][a-z0-9+\-.]*:)?(?:\/?\/(?:(?:[a-z0-9\-._~!$&'()*+,;=:]|%[0-9a-f]{2})*@)?(?:\[(?:(?:(?:(?:[0-9a-f]{1,4}:){6}|::(?:[0-9a-f]{1,4}:){5}|(?:[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){4}|(?:(?:[0-9a-f]{1,4}:){0,1}[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){3}|(?:(?:[0-9a-f]{1,4}:){0,2}[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){2}|(?:(?:[0-9a-f]{1,4}:){0,3}[0-9a-f]{1,4})?::[0-9a-f]{1,4}:|(?:(?:[0-9a-f]{1,4}:){0,4}[0-9a-f]{1,4})?::)(?:[0-9a-f]{1,4}:[0-9a-f]{1,4}|(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?))|(?:(?:[0-9a-f]{1,4}:){0,5}[0-9a-f]{1,4})?::[0-9a-f]{1,4}|(?:(?:[0-9a-f]{1,4}:){0,6}[0-9a-f]{1,4})?::)|[Vv][0-9a-f]+\.[a-z0-9\-._~!$&'()*+,;=:]+)\]|(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)|(?:[a-z0-9\-._~!$&'"()*+,;=]|%[0-9a-f]{2})*)(?::\d*)?(?:\/(?:[a-z0-9\-._~!$&'"()*+,;=:@]|%[0-9a-f]{2})*)*|\/(?:(?:[a-z0-9\-._~!$&'"()*+,;=:@]|%[0-9a-f]{2})+(?:\/(?:[a-z0-9\-._~!$&'"()*+,;=:@]|%[0-9a-f]{2})*)*)?|(?:[a-z0-9\-._~!$&'"()*+,;=:@]|%[0-9a-f]{2})+(?:\/(?:[a-z0-9\-._~!$&'"()*+,;=:@]|%[0-9a-f]{2})*)*)?(?:\?(?:[a-z0-9\-._~!$&'"()*+,;=:@/?]|%[0-9a-f]{2})*)?(?:#(?:[a-z0-9\-._~!$&'"()*+,;=:@/?]|%[0-9a-f]{2})*)?$/i;
  var URITEMPLATE = /^(?:(?:[^\x00-\x20"'<>%\\^`{|}]|%[0-9a-f]{2})|\{[+#./;?&=,!@|]?(?:[a-z0-9_]|%[0-9a-f]{2})+(?::[1-9][0-9]{0,3}|\*)?(?:,(?:[a-z0-9_]|%[0-9a-f]{2})+(?::[1-9][0-9]{0,3}|\*)?)*\})*$/i;
  var URL_ = /^(?:(?:https?|ftp):\/\/)(?:\S+(?::\S*)?@)?(?:(?!10(?:\.\d{1,3}){3})(?!127(?:\.\d{1,3}){3})(?!169\.254(?:\.\d{1,3}){2})(?!192\.168(?:\.\d{1,3}){2})(?!172\.(?:1[6-9]|2\d|3[0-1])(?:\.\d{1,3}){2})(?:[1-9]\d?|1\d\d|2[01]\d|22[0-3])(?:\.(?:1?\d{1,2}|2[0-4]\d|25[0-5])){2}(?:\.(?:[1-9]\d?|1\d\d|2[0-4]\d|25[0-4]))|(?:(?:[a-z\u{00a1}-\u{ffff}0-9]+-?)*[a-z\u{00a1}-\u{ffff}0-9]+)(?:\.(?:[a-z\u{00a1}-\u{ffff}0-9]+-?)*[a-z\u{00a1}-\u{ffff}0-9]+)*(?:\.(?:[a-z\u{00a1}-\u{ffff}]{2,})))(?::\d{2,5})?(?:\/[^\s]*)?$/iu;
  var UUID = /^(?:urn:uuid:)?[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
  var JSON_POINTER = /^(?:\/(?:[^~/]|~0|~1)*)*$/;
  var JSON_POINTER_URI_FRAGMENT = /^#(?:\/(?:[a-z0-9_\-.!$&'()*+,;:=@]|%[0-9a-f]{2}|~0|~1)*)*$/i;
  var RELATIVE_JSON_POINTER = /^(?:0|[1-9][0-9]*)(?:#|(?:\/(?:[^~/]|~0|~1)*)*)$/;
  var EMAIL = (input) => {
    if (input[0] === '"')
      return false;
    const [name, host, ...rest] = input.split("@");
    if (!name || !host || rest.length !== 0 || name.length > 64 || host.length > 253)
      return false;
    if (name[0] === "." || name.endsWith(".") || name.includes(".."))
      return false;
    if (!/^[a-z0-9.-]+$/i.test(host) || !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/i.test(name))
      return false;
    return host.split(".").every((part) => /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/i.test(part));
  };
  var IPV4 = /^(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)$/;
  var IPV6 = /^((([0-9a-f]{1,4}:){7}([0-9a-f]{1,4}|:))|(([0-9a-f]{1,4}:){6}(:[0-9a-f]{1,4}|((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3})|:))|(([0-9a-f]{1,4}:){5}(((:[0-9a-f]{1,4}){1,2})|:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3})|:))|(([0-9a-f]{1,4}:){4}(((:[0-9a-f]{1,4}){1,3})|((:[0-9a-f]{1,4})?:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(([0-9a-f]{1,4}:){3}(((:[0-9a-f]{1,4}){1,4})|((:[0-9a-f]{1,4}){0,2}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(([0-9a-f]{1,4}:){2}(((:[0-9a-f]{1,4}){1,5})|((:[0-9a-f]{1,4}){0,3}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(([0-9a-f]{1,4}:){1}(((:[0-9a-f]{1,4}){1,6})|((:[0-9a-f]{1,4}){0,4}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(:(((:[0-9a-f]{1,4}){1,7})|((:[0-9a-f]{1,4}){0,5}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:)))$/i;
  var DURATION = (input) => input.length > 1 && input.length < 80 && (/^P\d+([.,]\d+)?W$/.test(input) || /^P[\dYMDTHS]*(\d[.,]\d+)?[YMDHS]$/.test(input) && /^P([.,\d]+Y)?([.,\d]+M)?([.,\d]+D)?(T([.,\d]+H)?([.,\d]+M)?([.,\d]+S)?)?$/.test(input));
  function bind(r) {
    return r.test.bind(r);
  }
  var format = {
    date,
    time: time.bind(void 0, false),
    "date-time": date_time,
    duration: DURATION,
    uri,
    "uri-reference": bind(URIREF),
    "uri-template": bind(URITEMPLATE),
    url: bind(URL_),
    email: EMAIL,
    hostname: bind(HOSTNAME),
    ipv4: bind(IPV4),
    ipv6: bind(IPV6),
    regex,
    uuid: bind(UUID),
    "json-pointer": bind(JSON_POINTER),
    "json-pointer-uri-fragment": bind(JSON_POINTER_URI_FRAGMENT),
    "relative-json-pointer": bind(RELATIVE_JSON_POINTER)
  };
  function isLeapYear(year) {
    return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  }
  function date(str) {
    const matches = str.match(DATE);
    if (!matches)
      return false;
    const year = +matches[1];
    const month = +matches[2];
    const day = +matches[3];
    return month >= 1 && month <= 12 && day >= 1 && day <= (month == 2 && isLeapYear(year) ? 29 : DAYS[month]);
  }
  function time(full, str) {
    const matches = str.match(TIME);
    if (!matches)
      return false;
    const hour = +matches[1];
    const minute = +matches[2];
    const second = +matches[3];
    const timeZone = !!matches[5];
    return (hour <= 23 && minute <= 59 && second <= 59 || hour == 23 && minute == 59 && second == 60) && (!full || timeZone);
  }
  var DATE_TIME_SEPARATOR = /t|\s/i;
  function date_time(str) {
    const dateTime = str.split(DATE_TIME_SEPARATOR);
    return dateTime.length == 2 && date(dateTime[0]) && time(true, dateTime[1]);
  }
  var NOT_URI_FRAGMENT = /\/|:/;
  var URI_PATTERN = /^(?:[a-z][a-z0-9+\-.]*:)(?:\/?\/(?:(?:[a-z0-9\-._~!$&'()*+,;=:]|%[0-9a-f]{2})*@)?(?:\[(?:(?:(?:(?:[0-9a-f]{1,4}:){6}|::(?:[0-9a-f]{1,4}:){5}|(?:[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){4}|(?:(?:[0-9a-f]{1,4}:){0,1}[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){3}|(?:(?:[0-9a-f]{1,4}:){0,2}[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){2}|(?:(?:[0-9a-f]{1,4}:){0,3}[0-9a-f]{1,4})?::[0-9a-f]{1,4}:|(?:(?:[0-9a-f]{1,4}:){0,4}[0-9a-f]{1,4})?::)(?:[0-9a-f]{1,4}:[0-9a-f]{1,4}|(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?))|(?:(?:[0-9a-f]{1,4}:){0,5}[0-9a-f]{1,4})?::[0-9a-f]{1,4}|(?:(?:[0-9a-f]{1,4}:){0,6}[0-9a-f]{1,4})?::)|[Vv][0-9a-f]+\.[a-z0-9\-._~!$&'()*+,;=:]+)\]|(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)|(?:[a-z0-9\-._~!$&'()*+,;=]|%[0-9a-f]{2})*)(?::\d*)?(?:\/(?:[a-z0-9\-._~!$&'()*+,;=:@]|%[0-9a-f]{2})*)*|\/(?:(?:[a-z0-9\-._~!$&'()*+,;=:@]|%[0-9a-f]{2})+(?:\/(?:[a-z0-9\-._~!$&'()*+,;=:@]|%[0-9a-f]{2})*)*)?|(?:[a-z0-9\-._~!$&'()*+,;=:@]|%[0-9a-f]{2})+(?:\/(?:[a-z0-9\-._~!$&'()*+,;=:@]|%[0-9a-f]{2})*)*)(?:\?(?:[a-z0-9\-._~!$&'()*+,;=:@/?]|%[0-9a-f]{2})*)?(?:#(?:[a-z0-9\-._~!$&'()*+,;=:@/?]|%[0-9a-f]{2})*)?$/i;
  function uri(str) {
    return NOT_URI_FRAGMENT.test(str) && URI_PATTERN.test(str);
  }
  var Z_ANCHOR = /[^\\]\\Z/;
  function regex(str) {
    if (Z_ANCHOR.test(str))
      return false;
    try {
      new RegExp(str, "u");
      return true;
    } catch (e) {
      return false;
    }
  }

  // node_modules/.pnpm/@cfworker+json-schema@4.1.1/node_modules/@cfworker/json-schema/dist/esm/types.js
  var OutputFormat;
  (function(OutputFormat2) {
    OutputFormat2[OutputFormat2["Flag"] = 1] = "Flag";
    OutputFormat2[OutputFormat2["Basic"] = 2] = "Basic";
    OutputFormat2[OutputFormat2["Detailed"] = 4] = "Detailed";
  })(OutputFormat || (OutputFormat = {}));

  // node_modules/.pnpm/@cfworker+json-schema@4.1.1/node_modules/@cfworker/json-schema/dist/esm/ucs2-length.js
  function ucs2length(s) {
    let result = 0;
    let length = s.length;
    let index = 0;
    let charCode;
    while (index < length) {
      result++;
      charCode = s.charCodeAt(index++);
      if (charCode >= 55296 && charCode <= 56319 && index < length) {
        charCode = s.charCodeAt(index);
        if ((charCode & 64512) == 56320) {
          index++;
        }
      }
    }
    return result;
  }

  // node_modules/.pnpm/@cfworker+json-schema@4.1.1/node_modules/@cfworker/json-schema/dist/esm/validate.js
  function validate(instance, schema, draft = "2019-09", lookup = dereference(schema), shortCircuit = true, recursiveAnchor = null, instanceLocation = "#", schemaLocation = "#", evaluated = /* @__PURE__ */ Object.create(null)) {
    if (schema === true) {
      return { valid: true, errors: [] };
    }
    if (schema === false) {
      return {
        valid: false,
        errors: [
          {
            instanceLocation,
            keyword: "false",
            keywordLocation: instanceLocation,
            error: "False boolean schema."
          }
        ]
      };
    }
    const rawInstanceType = typeof instance;
    let instanceType;
    switch (rawInstanceType) {
      case "boolean":
      case "number":
      case "string":
        instanceType = rawInstanceType;
        break;
      case "object":
        if (instance === null) {
          instanceType = "null";
        } else if (Array.isArray(instance)) {
          instanceType = "array";
        } else {
          instanceType = "object";
        }
        break;
      default:
        throw new Error(`Instances of "${rawInstanceType}" type are not supported.`);
    }
    const { $ref, $recursiveRef, $recursiveAnchor, type: $type, const: $const, enum: $enum, required: $required, not: $not, anyOf: $anyOf, allOf: $allOf, oneOf: $oneOf, if: $if, then: $then, else: $else, format: $format, properties: $properties, patternProperties: $patternProperties, additionalProperties: $additionalProperties, unevaluatedProperties: $unevaluatedProperties, minProperties: $minProperties, maxProperties: $maxProperties, propertyNames: $propertyNames, dependentRequired: $dependentRequired, dependentSchemas: $dependentSchemas, dependencies: $dependencies, prefixItems: $prefixItems, items: $items, additionalItems: $additionalItems, unevaluatedItems: $unevaluatedItems, contains: $contains, minContains: $minContains, maxContains: $maxContains, minItems: $minItems, maxItems: $maxItems, uniqueItems: $uniqueItems, minimum: $minimum, maximum: $maximum, exclusiveMinimum: $exclusiveMinimum, exclusiveMaximum: $exclusiveMaximum, multipleOf: $multipleOf, minLength: $minLength, maxLength: $maxLength, pattern: $pattern, __absolute_ref__, __absolute_recursive_ref__ } = schema;
    const errors = [];
    if ($recursiveAnchor === true && recursiveAnchor === null) {
      recursiveAnchor = schema;
    }
    if ($recursiveRef === "#") {
      const refSchema = recursiveAnchor === null ? lookup[__absolute_recursive_ref__] : recursiveAnchor;
      const keywordLocation = `${schemaLocation}/$recursiveRef`;
      const result = validate(instance, recursiveAnchor === null ? schema : recursiveAnchor, draft, lookup, shortCircuit, refSchema, instanceLocation, keywordLocation, evaluated);
      if (!result.valid) {
        errors.push({
          instanceLocation,
          keyword: "$recursiveRef",
          keywordLocation,
          error: "A subschema had errors."
        }, ...result.errors);
      }
    }
    if ($ref !== void 0) {
      const uri2 = __absolute_ref__ || $ref;
      const refSchema = lookup[uri2];
      if (refSchema === void 0) {
        let message = `Unresolved $ref "${$ref}".`;
        if (__absolute_ref__ && __absolute_ref__ !== $ref) {
          message += `  Absolute URI "${__absolute_ref__}".`;
        }
        message += `
Known schemas:
- ${Object.keys(lookup).join("\n- ")}`;
        throw new Error(message);
      }
      const keywordLocation = `${schemaLocation}/$ref`;
      const result = validate(instance, refSchema, draft, lookup, shortCircuit, recursiveAnchor, instanceLocation, keywordLocation, evaluated);
      if (!result.valid) {
        errors.push({
          instanceLocation,
          keyword: "$ref",
          keywordLocation,
          error: "A subschema had errors."
        }, ...result.errors);
      }
      if (draft === "4" || draft === "7") {
        return { valid: errors.length === 0, errors };
      }
    }
    if (Array.isArray($type)) {
      let length = $type.length;
      let valid = false;
      for (let i = 0; i < length; i++) {
        if (instanceType === $type[i] || $type[i] === "integer" && instanceType === "number" && instance % 1 === 0 && instance === instance) {
          valid = true;
          break;
        }
      }
      if (!valid) {
        errors.push({
          instanceLocation,
          keyword: "type",
          keywordLocation: `${schemaLocation}/type`,
          error: `Instance type "${instanceType}" is invalid. Expected "${$type.join('", "')}".`
        });
      }
    } else if ($type === "integer") {
      if (instanceType !== "number" || instance % 1 || instance !== instance) {
        errors.push({
          instanceLocation,
          keyword: "type",
          keywordLocation: `${schemaLocation}/type`,
          error: `Instance type "${instanceType}" is invalid. Expected "${$type}".`
        });
      }
    } else if ($type !== void 0 && instanceType !== $type) {
      errors.push({
        instanceLocation,
        keyword: "type",
        keywordLocation: `${schemaLocation}/type`,
        error: `Instance type "${instanceType}" is invalid. Expected "${$type}".`
      });
    }
    if ($const !== void 0) {
      if (instanceType === "object" || instanceType === "array") {
        if (!deepCompareStrict(instance, $const)) {
          errors.push({
            instanceLocation,
            keyword: "const",
            keywordLocation: `${schemaLocation}/const`,
            error: `Instance does not match ${JSON.stringify($const)}.`
          });
        }
      } else if (instance !== $const) {
        errors.push({
          instanceLocation,
          keyword: "const",
          keywordLocation: `${schemaLocation}/const`,
          error: `Instance does not match ${JSON.stringify($const)}.`
        });
      }
    }
    if ($enum !== void 0) {
      if (instanceType === "object" || instanceType === "array") {
        if (!$enum.some((value) => deepCompareStrict(instance, value))) {
          errors.push({
            instanceLocation,
            keyword: "enum",
            keywordLocation: `${schemaLocation}/enum`,
            error: `Instance does not match any of ${JSON.stringify($enum)}.`
          });
        }
      } else if (!$enum.some((value) => instance === value)) {
        errors.push({
          instanceLocation,
          keyword: "enum",
          keywordLocation: `${schemaLocation}/enum`,
          error: `Instance does not match any of ${JSON.stringify($enum)}.`
        });
      }
    }
    if ($not !== void 0) {
      const keywordLocation = `${schemaLocation}/not`;
      const result = validate(instance, $not, draft, lookup, shortCircuit, recursiveAnchor, instanceLocation, keywordLocation);
      if (result.valid) {
        errors.push({
          instanceLocation,
          keyword: "not",
          keywordLocation,
          error: 'Instance matched "not" schema.'
        });
      }
    }
    let subEvaluateds = [];
    if ($anyOf !== void 0) {
      const keywordLocation = `${schemaLocation}/anyOf`;
      const errorsLength = errors.length;
      let anyValid = false;
      for (let i = 0; i < $anyOf.length; i++) {
        const subSchema = $anyOf[i];
        const subEvaluated = Object.create(evaluated);
        const result = validate(instance, subSchema, draft, lookup, shortCircuit, $recursiveAnchor === true ? recursiveAnchor : null, instanceLocation, `${keywordLocation}/${i}`, subEvaluated);
        errors.push(...result.errors);
        anyValid = anyValid || result.valid;
        if (result.valid) {
          subEvaluateds.push(subEvaluated);
        }
      }
      if (anyValid) {
        errors.length = errorsLength;
      } else {
        errors.splice(errorsLength, 0, {
          instanceLocation,
          keyword: "anyOf",
          keywordLocation,
          error: "Instance does not match any subschemas."
        });
      }
    }
    if ($allOf !== void 0) {
      const keywordLocation = `${schemaLocation}/allOf`;
      const errorsLength = errors.length;
      let allValid = true;
      for (let i = 0; i < $allOf.length; i++) {
        const subSchema = $allOf[i];
        const subEvaluated = Object.create(evaluated);
        const result = validate(instance, subSchema, draft, lookup, shortCircuit, $recursiveAnchor === true ? recursiveAnchor : null, instanceLocation, `${keywordLocation}/${i}`, subEvaluated);
        errors.push(...result.errors);
        allValid = allValid && result.valid;
        if (result.valid) {
          subEvaluateds.push(subEvaluated);
        }
      }
      if (allValid) {
        errors.length = errorsLength;
      } else {
        errors.splice(errorsLength, 0, {
          instanceLocation,
          keyword: "allOf",
          keywordLocation,
          error: `Instance does not match every subschema.`
        });
      }
    }
    if ($oneOf !== void 0) {
      const keywordLocation = `${schemaLocation}/oneOf`;
      const errorsLength = errors.length;
      const matches = $oneOf.filter((subSchema, i) => {
        const subEvaluated = Object.create(evaluated);
        const result = validate(instance, subSchema, draft, lookup, shortCircuit, $recursiveAnchor === true ? recursiveAnchor : null, instanceLocation, `${keywordLocation}/${i}`, subEvaluated);
        errors.push(...result.errors);
        if (result.valid) {
          subEvaluateds.push(subEvaluated);
        }
        return result.valid;
      }).length;
      if (matches === 1) {
        errors.length = errorsLength;
      } else {
        errors.splice(errorsLength, 0, {
          instanceLocation,
          keyword: "oneOf",
          keywordLocation,
          error: `Instance does not match exactly one subschema (${matches} matches).`
        });
      }
    }
    if (instanceType === "object" || instanceType === "array") {
      Object.assign(evaluated, ...subEvaluateds);
    }
    if ($if !== void 0) {
      const keywordLocation = `${schemaLocation}/if`;
      const conditionResult = validate(instance, $if, draft, lookup, shortCircuit, recursiveAnchor, instanceLocation, keywordLocation, evaluated).valid;
      if (conditionResult) {
        if ($then !== void 0) {
          const thenResult = validate(instance, $then, draft, lookup, shortCircuit, recursiveAnchor, instanceLocation, `${schemaLocation}/then`, evaluated);
          if (!thenResult.valid) {
            errors.push({
              instanceLocation,
              keyword: "if",
              keywordLocation,
              error: `Instance does not match "then" schema.`
            }, ...thenResult.errors);
          }
        }
      } else if ($else !== void 0) {
        const elseResult = validate(instance, $else, draft, lookup, shortCircuit, recursiveAnchor, instanceLocation, `${schemaLocation}/else`, evaluated);
        if (!elseResult.valid) {
          errors.push({
            instanceLocation,
            keyword: "if",
            keywordLocation,
            error: `Instance does not match "else" schema.`
          }, ...elseResult.errors);
        }
      }
    }
    if (instanceType === "object") {
      if ($required !== void 0) {
        for (const key of $required) {
          if (!(key in instance)) {
            errors.push({
              instanceLocation,
              keyword: "required",
              keywordLocation: `${schemaLocation}/required`,
              error: `Instance does not have required property "${key}".`
            });
          }
        }
      }
      const keys = Object.keys(instance);
      if ($minProperties !== void 0 && keys.length < $minProperties) {
        errors.push({
          instanceLocation,
          keyword: "minProperties",
          keywordLocation: `${schemaLocation}/minProperties`,
          error: `Instance does not have at least ${$minProperties} properties.`
        });
      }
      if ($maxProperties !== void 0 && keys.length > $maxProperties) {
        errors.push({
          instanceLocation,
          keyword: "maxProperties",
          keywordLocation: `${schemaLocation}/maxProperties`,
          error: `Instance does not have at least ${$maxProperties} properties.`
        });
      }
      if ($propertyNames !== void 0) {
        const keywordLocation = `${schemaLocation}/propertyNames`;
        for (const key in instance) {
          const subInstancePointer = `${instanceLocation}/${encodePointer(key)}`;
          const result = validate(key, $propertyNames, draft, lookup, shortCircuit, recursiveAnchor, subInstancePointer, keywordLocation);
          if (!result.valid) {
            errors.push({
              instanceLocation,
              keyword: "propertyNames",
              keywordLocation,
              error: `Property name "${key}" does not match schema.`
            }, ...result.errors);
          }
        }
      }
      if ($dependentRequired !== void 0) {
        const keywordLocation = `${schemaLocation}/dependantRequired`;
        for (const key in $dependentRequired) {
          if (key in instance) {
            const required = $dependentRequired[key];
            for (const dependantKey of required) {
              if (!(dependantKey in instance)) {
                errors.push({
                  instanceLocation,
                  keyword: "dependentRequired",
                  keywordLocation,
                  error: `Instance has "${key}" but does not have "${dependantKey}".`
                });
              }
            }
          }
        }
      }
      if ($dependentSchemas !== void 0) {
        for (const key in $dependentSchemas) {
          const keywordLocation = `${schemaLocation}/dependentSchemas`;
          if (key in instance) {
            const result = validate(instance, $dependentSchemas[key], draft, lookup, shortCircuit, recursiveAnchor, instanceLocation, `${keywordLocation}/${encodePointer(key)}`, evaluated);
            if (!result.valid) {
              errors.push({
                instanceLocation,
                keyword: "dependentSchemas",
                keywordLocation,
                error: `Instance has "${key}" but does not match dependant schema.`
              }, ...result.errors);
            }
          }
        }
      }
      if ($dependencies !== void 0) {
        const keywordLocation = `${schemaLocation}/dependencies`;
        for (const key in $dependencies) {
          if (key in instance) {
            const propsOrSchema = $dependencies[key];
            if (Array.isArray(propsOrSchema)) {
              for (const dependantKey of propsOrSchema) {
                if (!(dependantKey in instance)) {
                  errors.push({
                    instanceLocation,
                    keyword: "dependencies",
                    keywordLocation,
                    error: `Instance has "${key}" but does not have "${dependantKey}".`
                  });
                }
              }
            } else {
              const result = validate(instance, propsOrSchema, draft, lookup, shortCircuit, recursiveAnchor, instanceLocation, `${keywordLocation}/${encodePointer(key)}`);
              if (!result.valid) {
                errors.push({
                  instanceLocation,
                  keyword: "dependencies",
                  keywordLocation,
                  error: `Instance has "${key}" but does not match dependant schema.`
                }, ...result.errors);
              }
            }
          }
        }
      }
      const thisEvaluated = /* @__PURE__ */ Object.create(null);
      let stop = false;
      if ($properties !== void 0) {
        const keywordLocation = `${schemaLocation}/properties`;
        for (const key in $properties) {
          if (!(key in instance)) {
            continue;
          }
          const subInstancePointer = `${instanceLocation}/${encodePointer(key)}`;
          const result = validate(instance[key], $properties[key], draft, lookup, shortCircuit, recursiveAnchor, subInstancePointer, `${keywordLocation}/${encodePointer(key)}`);
          if (result.valid) {
            evaluated[key] = thisEvaluated[key] = true;
          } else {
            stop = shortCircuit;
            errors.push({
              instanceLocation,
              keyword: "properties",
              keywordLocation,
              error: `Property "${key}" does not match schema.`
            }, ...result.errors);
            if (stop)
              break;
          }
        }
      }
      if (!stop && $patternProperties !== void 0) {
        const keywordLocation = `${schemaLocation}/patternProperties`;
        for (const pattern in $patternProperties) {
          const regex2 = new RegExp(pattern, "u");
          const subSchema = $patternProperties[pattern];
          for (const key in instance) {
            if (!regex2.test(key)) {
              continue;
            }
            const subInstancePointer = `${instanceLocation}/${encodePointer(key)}`;
            const result = validate(instance[key], subSchema, draft, lookup, shortCircuit, recursiveAnchor, subInstancePointer, `${keywordLocation}/${encodePointer(pattern)}`);
            if (result.valid) {
              evaluated[key] = thisEvaluated[key] = true;
            } else {
              stop = shortCircuit;
              errors.push({
                instanceLocation,
                keyword: "patternProperties",
                keywordLocation,
                error: `Property "${key}" matches pattern "${pattern}" but does not match associated schema.`
              }, ...result.errors);
            }
          }
        }
      }
      if (!stop && $additionalProperties !== void 0) {
        const keywordLocation = `${schemaLocation}/additionalProperties`;
        for (const key in instance) {
          if (thisEvaluated[key]) {
            continue;
          }
          const subInstancePointer = `${instanceLocation}/${encodePointer(key)}`;
          const result = validate(instance[key], $additionalProperties, draft, lookup, shortCircuit, recursiveAnchor, subInstancePointer, keywordLocation);
          if (result.valid) {
            evaluated[key] = true;
          } else {
            stop = shortCircuit;
            errors.push({
              instanceLocation,
              keyword: "additionalProperties",
              keywordLocation,
              error: `Property "${key}" does not match additional properties schema.`
            }, ...result.errors);
          }
        }
      } else if (!stop && $unevaluatedProperties !== void 0) {
        const keywordLocation = `${schemaLocation}/unevaluatedProperties`;
        for (const key in instance) {
          if (!evaluated[key]) {
            const subInstancePointer = `${instanceLocation}/${encodePointer(key)}`;
            const result = validate(instance[key], $unevaluatedProperties, draft, lookup, shortCircuit, recursiveAnchor, subInstancePointer, keywordLocation);
            if (result.valid) {
              evaluated[key] = true;
            } else {
              errors.push({
                instanceLocation,
                keyword: "unevaluatedProperties",
                keywordLocation,
                error: `Property "${key}" does not match unevaluated properties schema.`
              }, ...result.errors);
            }
          }
        }
      }
    } else if (instanceType === "array") {
      if ($maxItems !== void 0 && instance.length > $maxItems) {
        errors.push({
          instanceLocation,
          keyword: "maxItems",
          keywordLocation: `${schemaLocation}/maxItems`,
          error: `Array has too many items (${instance.length} > ${$maxItems}).`
        });
      }
      if ($minItems !== void 0 && instance.length < $minItems) {
        errors.push({
          instanceLocation,
          keyword: "minItems",
          keywordLocation: `${schemaLocation}/minItems`,
          error: `Array has too few items (${instance.length} < ${$minItems}).`
        });
      }
      const length = instance.length;
      let i = 0;
      let stop = false;
      if ($prefixItems !== void 0) {
        const keywordLocation = `${schemaLocation}/prefixItems`;
        const length2 = Math.min($prefixItems.length, length);
        for (; i < length2; i++) {
          const result = validate(instance[i], $prefixItems[i], draft, lookup, shortCircuit, recursiveAnchor, `${instanceLocation}/${i}`, `${keywordLocation}/${i}`);
          evaluated[i] = true;
          if (!result.valid) {
            stop = shortCircuit;
            errors.push({
              instanceLocation,
              keyword: "prefixItems",
              keywordLocation,
              error: `Items did not match schema.`
            }, ...result.errors);
            if (stop)
              break;
          }
        }
      }
      if ($items !== void 0) {
        const keywordLocation = `${schemaLocation}/items`;
        if (Array.isArray($items)) {
          const length2 = Math.min($items.length, length);
          for (; i < length2; i++) {
            const result = validate(instance[i], $items[i], draft, lookup, shortCircuit, recursiveAnchor, `${instanceLocation}/${i}`, `${keywordLocation}/${i}`);
            evaluated[i] = true;
            if (!result.valid) {
              stop = shortCircuit;
              errors.push({
                instanceLocation,
                keyword: "items",
                keywordLocation,
                error: `Items did not match schema.`
              }, ...result.errors);
              if (stop)
                break;
            }
          }
        } else {
          for (; i < length; i++) {
            const result = validate(instance[i], $items, draft, lookup, shortCircuit, recursiveAnchor, `${instanceLocation}/${i}`, keywordLocation);
            evaluated[i] = true;
            if (!result.valid) {
              stop = shortCircuit;
              errors.push({
                instanceLocation,
                keyword: "items",
                keywordLocation,
                error: `Items did not match schema.`
              }, ...result.errors);
              if (stop)
                break;
            }
          }
        }
        if (!stop && $additionalItems !== void 0) {
          const keywordLocation2 = `${schemaLocation}/additionalItems`;
          for (; i < length; i++) {
            const result = validate(instance[i], $additionalItems, draft, lookup, shortCircuit, recursiveAnchor, `${instanceLocation}/${i}`, keywordLocation2);
            evaluated[i] = true;
            if (!result.valid) {
              stop = shortCircuit;
              errors.push({
                instanceLocation,
                keyword: "additionalItems",
                keywordLocation: keywordLocation2,
                error: `Items did not match additional items schema.`
              }, ...result.errors);
            }
          }
        }
      }
      if ($contains !== void 0) {
        if (length === 0 && $minContains === void 0) {
          errors.push({
            instanceLocation,
            keyword: "contains",
            keywordLocation: `${schemaLocation}/contains`,
            error: `Array is empty. It must contain at least one item matching the schema.`
          });
        } else if ($minContains !== void 0 && length < $minContains) {
          errors.push({
            instanceLocation,
            keyword: "minContains",
            keywordLocation: `${schemaLocation}/minContains`,
            error: `Array has less items (${length}) than minContains (${$minContains}).`
          });
        } else {
          const keywordLocation = `${schemaLocation}/contains`;
          const errorsLength = errors.length;
          let contained = 0;
          for (let j = 0; j < length; j++) {
            const result = validate(instance[j], $contains, draft, lookup, shortCircuit, recursiveAnchor, `${instanceLocation}/${j}`, keywordLocation);
            if (result.valid) {
              evaluated[j] = true;
              contained++;
            } else {
              errors.push(...result.errors);
            }
          }
          if (contained >= ($minContains || 0)) {
            errors.length = errorsLength;
          }
          if ($minContains === void 0 && $maxContains === void 0 && contained === 0) {
            errors.splice(errorsLength, 0, {
              instanceLocation,
              keyword: "contains",
              keywordLocation,
              error: `Array does not contain item matching schema.`
            });
          } else if ($minContains !== void 0 && contained < $minContains) {
            errors.push({
              instanceLocation,
              keyword: "minContains",
              keywordLocation: `${schemaLocation}/minContains`,
              error: `Array must contain at least ${$minContains} items matching schema. Only ${contained} items were found.`
            });
          } else if ($maxContains !== void 0 && contained > $maxContains) {
            errors.push({
              instanceLocation,
              keyword: "maxContains",
              keywordLocation: `${schemaLocation}/maxContains`,
              error: `Array may contain at most ${$maxContains} items matching schema. ${contained} items were found.`
            });
          }
        }
      }
      if (!stop && $unevaluatedItems !== void 0) {
        const keywordLocation = `${schemaLocation}/unevaluatedItems`;
        for (i; i < length; i++) {
          if (evaluated[i]) {
            continue;
          }
          const result = validate(instance[i], $unevaluatedItems, draft, lookup, shortCircuit, recursiveAnchor, `${instanceLocation}/${i}`, keywordLocation);
          evaluated[i] = true;
          if (!result.valid) {
            errors.push({
              instanceLocation,
              keyword: "unevaluatedItems",
              keywordLocation,
              error: `Items did not match unevaluated items schema.`
            }, ...result.errors);
          }
        }
      }
      if ($uniqueItems) {
        for (let j = 0; j < length; j++) {
          const a = instance[j];
          const ao = typeof a === "object" && a !== null;
          for (let k = 0; k < length; k++) {
            if (j === k) {
              continue;
            }
            const b = instance[k];
            const bo = typeof b === "object" && b !== null;
            if (a === b || ao && bo && deepCompareStrict(a, b)) {
              errors.push({
                instanceLocation,
                keyword: "uniqueItems",
                keywordLocation: `${schemaLocation}/uniqueItems`,
                error: `Duplicate items at indexes ${j} and ${k}.`
              });
              j = Number.MAX_SAFE_INTEGER;
              k = Number.MAX_SAFE_INTEGER;
            }
          }
        }
      }
    } else if (instanceType === "number") {
      if (draft === "4") {
        if ($minimum !== void 0 && ($exclusiveMinimum === true && instance <= $minimum || instance < $minimum)) {
          errors.push({
            instanceLocation,
            keyword: "minimum",
            keywordLocation: `${schemaLocation}/minimum`,
            error: `${instance} is less than ${$exclusiveMinimum ? "or equal to " : ""} ${$minimum}.`
          });
        }
        if ($maximum !== void 0 && ($exclusiveMaximum === true && instance >= $maximum || instance > $maximum)) {
          errors.push({
            instanceLocation,
            keyword: "maximum",
            keywordLocation: `${schemaLocation}/maximum`,
            error: `${instance} is greater than ${$exclusiveMaximum ? "or equal to " : ""} ${$maximum}.`
          });
        }
      } else {
        if ($minimum !== void 0 && instance < $minimum) {
          errors.push({
            instanceLocation,
            keyword: "minimum",
            keywordLocation: `${schemaLocation}/minimum`,
            error: `${instance} is less than ${$minimum}.`
          });
        }
        if ($maximum !== void 0 && instance > $maximum) {
          errors.push({
            instanceLocation,
            keyword: "maximum",
            keywordLocation: `${schemaLocation}/maximum`,
            error: `${instance} is greater than ${$maximum}.`
          });
        }
        if ($exclusiveMinimum !== void 0 && instance <= $exclusiveMinimum) {
          errors.push({
            instanceLocation,
            keyword: "exclusiveMinimum",
            keywordLocation: `${schemaLocation}/exclusiveMinimum`,
            error: `${instance} is less than ${$exclusiveMinimum}.`
          });
        }
        if ($exclusiveMaximum !== void 0 && instance >= $exclusiveMaximum) {
          errors.push({
            instanceLocation,
            keyword: "exclusiveMaximum",
            keywordLocation: `${schemaLocation}/exclusiveMaximum`,
            error: `${instance} is greater than or equal to ${$exclusiveMaximum}.`
          });
        }
      }
      if ($multipleOf !== void 0) {
        const remainder = instance % $multipleOf;
        if (Math.abs(0 - remainder) >= 11920929e-14 && Math.abs($multipleOf - remainder) >= 11920929e-14) {
          errors.push({
            instanceLocation,
            keyword: "multipleOf",
            keywordLocation: `${schemaLocation}/multipleOf`,
            error: `${instance} is not a multiple of ${$multipleOf}.`
          });
        }
      }
    } else if (instanceType === "string") {
      const length = $minLength === void 0 && $maxLength === void 0 ? 0 : ucs2length(instance);
      if ($minLength !== void 0 && length < $minLength) {
        errors.push({
          instanceLocation,
          keyword: "minLength",
          keywordLocation: `${schemaLocation}/minLength`,
          error: `String is too short (${length} < ${$minLength}).`
        });
      }
      if ($maxLength !== void 0 && length > $maxLength) {
        errors.push({
          instanceLocation,
          keyword: "maxLength",
          keywordLocation: `${schemaLocation}/maxLength`,
          error: `String is too long (${length} > ${$maxLength}).`
        });
      }
      if ($pattern !== void 0 && !new RegExp($pattern, "u").test(instance)) {
        errors.push({
          instanceLocation,
          keyword: "pattern",
          keywordLocation: `${schemaLocation}/pattern`,
          error: `String does not match pattern.`
        });
      }
      if ($format !== void 0 && format[$format] && !format[$format](instance)) {
        errors.push({
          instanceLocation,
          keyword: "format",
          keywordLocation: `${schemaLocation}/format`,
          error: `String does not match format "${$format}".`
        });
      }
    }
    return { valid: errors.length === 0, errors };
  }

  // node_modules/.pnpm/@cfworker+json-schema@4.1.1/node_modules/@cfworker/json-schema/dist/esm/validator.js
  var Validator = class {
    constructor(schema, draft = "2019-09", shortCircuit = true) {
      __publicField(this, "schema");
      __publicField(this, "draft");
      __publicField(this, "shortCircuit");
      __publicField(this, "lookup");
      this.schema = schema;
      this.draft = draft;
      this.shortCircuit = shortCircuit;
      this.lookup = dereference(schema);
    }
    validate(instance) {
      return validate(instance, this.schema, this.draft, this.lookup, this.shortCircuit);
    }
    addSchema(schema, id) {
      if (id) {
        schema = { ...schema, $id: id };
      }
      dereference(schema, this.lookup);
    }
  };

  // src/static/sdk-libs/validate/formats.js
  var IBAN_LENGTHS = {
    AD: 24,
    AE: 23,
    AL: 28,
    AT: 20,
    AZ: 28,
    BA: 20,
    BE: 16,
    BG: 22,
    BH: 22,
    BR: 29,
    BY: 28,
    CH: 21,
    CR: 22,
    CY: 28,
    CZ: 24,
    DE: 22,
    DK: 18,
    DO: 28,
    EE: 20,
    EG: 29,
    ES: 24,
    FI: 18,
    FO: 18,
    FR: 27,
    GB: 22,
    GE: 22,
    GI: 23,
    GL: 18,
    GR: 27,
    GT: 28,
    HR: 21,
    HU: 28,
    IE: 22,
    IL: 23,
    IQ: 23,
    IS: 26,
    IT: 27,
    JO: 30,
    KW: 30,
    KZ: 20,
    LB: 28,
    LC: 32,
    LI: 21,
    LT: 20,
    LU: 20,
    LV: 21,
    MC: 27,
    MD: 24,
    ME: 22,
    MK: 19,
    MR: 27,
    MT: 31,
    MU: 30,
    NL: 18,
    NO: 15,
    PK: 24,
    PL: 28,
    PS: 29,
    PT: 25,
    QA: 29,
    RO: 24,
    RS: 22,
    SA: 24,
    SC: 31,
    SE: 24,
    SI: 19,
    SK: 24,
    SM: 27,
    ST: 25,
    SV: 28,
    TL: 23,
    TN: 24,
    TR: 26,
    UA: 29,
    VA: 22,
    VG: 24,
    XK: 20
  };
  var HETU_CHECK = "0123456789ABCDEFHJKLMNPRSTUVWXY";
  var HETU_CENTURY = { "+": 1800, "-": 1900, Y: 1900, X: 1900, W: 1900, V: 1900, U: 1900, A: 2e3, B: 2e3, C: 2e3, D: 2e3, E: 2e3, F: 2e3 };
  function realDay(y, m, d) {
    if (m < 1 || m > 12 || d < 1) return false;
    const days = [31, y % 4 === 0 && y % 100 !== 0 || y % 400 === 0 ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    return d <= days[m - 1];
  }
  function mod97(digits) {
    let rest = 0;
    for (let i = 0; i < digits.length; i += 7) rest = Number(String(rest) + digits.slice(i, i + 7)) % 97;
    return rest;
  }
  var FORMAT_TESTS = {
    /** Y-tunnus: seven digits, a hyphen and a check digit (weights 7 9 10 5 8 4 2, mod 11). */
    "fi-business-id": function(value) {
      const m = /^(\d{7})-(\d)$/.exec(String(value).trim());
      if (!m) return "shape";
      const weights = [7, 9, 10, 5, 8, 4, 2];
      let sum = 0;
      for (let i = 0; i < 7; i++) sum += Number(m[1][i]) * weights[i];
      const rest = sum % 11;
      if (rest === 1) return "check";
      return (rest === 0 ? 0 : 11 - rest) === Number(m[2]) ? true : "check";
    },
    /** Henkilötunnus: DDMMYY, a century separator, a three-digit individual number and a check character. */
    "fi-personal-id": function(value) {
      const m = /^(\d{2})(\d{2})(\d{2})([-+ABCDEFUVWXY])(\d{3})([0-9A-Y])$/.exec(String(value).trim().toUpperCase());
      if (!m) return "shape";
      const year = HETU_CENTURY[
        /** @type {keyof typeof HETU_CENTURY} */
        m[4]
      ] + Number(m[3]);
      if (!realDay(year, Number(m[2]), Number(m[1]))) return "date";
      return HETU_CHECK[Number(m[1] + m[2] + m[3] + m[5]) % 31] === m[6] ? true : "check";
    },
    /** IBAN: country, two check digits and the account, spaces allowed; length per country, then mod 97. */
    iban: function(value) {
      const compact = String(value).replace(/\s+/g, "").toUpperCase();
      if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(compact)) return "shape";
      const expected = IBAN_LENGTHS[
        /** @type {keyof typeof IBAN_LENGTHS} */
        compact.slice(0, 2)
      ];
      if (expected && compact.length !== expected) return "length";
      const moved = compact.slice(4) + compact.slice(0, 4);
      const digits = moved.replace(/[A-Z]/g, function(c) {
        return String(c.charCodeAt(0) - 55);
      });
      return mod97(digits) === 1 ? true : "check";
    },
    /** Postinumero: five digits. */
    "fi-postal-code": function(value) {
      return /^\d{5}$/.test(String(value).trim()) ? true : "shape";
    },
    /** A phone number: an optional +, then 6 to 15 digits; spaces, hyphens, dots and brackets are allowed between them. */
    phone: function(value) {
      const s = String(value).trim();
      if (!/^\+?[\d\s().-]+$/.test(s)) return "shape";
      const digits = s.replace(/\D/g, "");
      return digits.length >= 6 && digits.length <= 15 ? true : "shape";
    }
  };

  // src/static/sdk-libs/validate/messages.js
  var MESSAGES = {
    en: {
      required: "Fill in this field.",
      requiredBecause: "Fill in this field too, because {other} is filled in.",
      minLength: "Write at least {n} characters.",
      minLength1: "Write at least one character.",
      maxLength: "At most {n} characters. There are {len} now.",
      pattern: "Check the format.",
      format: "Check the format.",
      minimum: "The smallest allowed value is {n}.",
      maximum: "The largest allowed value is {n}.",
      exclusiveMinimum: "The value must be greater than {n}.",
      exclusiveMaximum: "The value must be less than {n}.",
      multipleOf: "Use steps of {n}.",
      enum: "Choose one of the options.",
      const: "The value must be {value}.",
      constTrue: "Tick this to continue.",
      typeNumber: "Write a number here.",
      typeInteger: "Write a whole number here.",
      type: "This value does not fit this field.",
      minItems: "Choose at least {n}.",
      maxItems: "Choose at most {n}.",
      uniqueItems: "The same value is in the list twice.",
      sameAs: "This does not match {other}.",
      anyOf: "Fill in at least one of these: {fields}.",
      oneOf: "Fill in only one of these: {fields}.",
      choice: "Check these details.",
      not: "This value is not accepted.",
      additional: "This information is not accepted here."
    },
    fi: {
      required: "Täytä tämä kenttä.",
      requiredBecause: "Täytä myös tämä, koska {other} on täytetty.",
      minLength: "Kirjoita vähintään {n} merkkiä.",
      minLength1: "Kirjoita vähintään yksi merkki.",
      maxLength: "Enintään {n} merkkiä. Nyt merkkejä on {len}.",
      pattern: "Tarkista muoto.",
      format: "Tarkista muoto.",
      minimum: "Pienin sallittu arvo on {n}.",
      maximum: "Suurin sallittu arvo on {n}.",
      exclusiveMinimum: "Arvon pitää olla suurempi kuin {n}.",
      exclusiveMaximum: "Arvon pitää olla pienempi kuin {n}.",
      multipleOf: "Sallitut arvot menevät {n}:n välein.",
      enum: "Valitse jokin vaihtoehdoista.",
      const: "Arvon pitää olla {value}.",
      constTrue: "Valitse tämä, jotta voit jatkaa.",
      typeNumber: "Kirjoita tähän luku.",
      typeInteger: "Kirjoita tähän kokonaisluku.",
      type: "Tämä arvo ei sovi tähän kenttään.",
      minItems: "Valitse vähintään {n}.",
      maxItems: "Valitse enintään {n}.",
      uniqueItems: "Sama arvo on luettelossa kahdesti.",
      sameAs: "Tämä ei ole sama kuin kentässä {other}.",
      anyOf: "Täytä ainakin yksi näistä: {fields}.",
      oneOf: "Täytä vain yksi näistä: {fields}.",
      choice: "Tarkista nämä tiedot.",
      not: "Tämä arvo ei kelpaa.",
      additional: "Tätä tietoa ei voi antaa tässä."
    },
    es: {
      required: "Completa este campo.",
      requiredBecause: "Completa también este campo, porque {other} tiene un valor.",
      minLength: "Escribe al menos {n} caracteres.",
      minLength1: "Escribe al menos un carácter.",
      maxLength: "Máximo {n} caracteres. Ahora hay {len}.",
      pattern: "Revisa el formato.",
      format: "Revisa el formato.",
      minimum: "El valor mínimo es {n}.",
      maximum: "El valor máximo es {n}.",
      exclusiveMinimum: "El valor debe ser mayor que {n}.",
      exclusiveMaximum: "El valor debe ser menor que {n}.",
      multipleOf: "Usa valores de {n} en {n}.",
      enum: "Elige una de las opciones.",
      const: "El valor debe ser {value}.",
      constTrue: "Marca esta casilla para continuar.",
      typeNumber: "Escribe un número aquí.",
      typeInteger: "Escribe un número entero aquí.",
      type: "Este valor no corresponde a este campo.",
      minItems: "Elige al menos {n}.",
      maxItems: "Elige como máximo {n}.",
      uniqueItems: "El mismo valor aparece dos veces en la lista.",
      sameAs: "No coincide con {other}.",
      anyOf: "Completa al menos uno de estos: {fields}.",
      oneOf: "Completa solo uno de estos: {fields}.",
      choice: "Revisa estos datos.",
      not: "Este valor no es válido.",
      additional: "Este dato no se acepta aquí."
    }
  };
  var LIST_WORD = { en: "or", fi: "tai", es: "o" };
  var FORMAT_HINTS = {
    en: {
      email: "For example name@example.com.",
      uri: "Starts with https://, for example https://example.com.",
      url: "Starts with https://, for example https://example.com.",
      date: "For example 2026-10-05.",
      time: "For example 14:30:00.",
      "fi-business-id": "Seven digits, a hyphen and a check digit, for example 0737546-2.",
      "fi-personal-id": "For example 131052-308T.",
      iban: "For example FI21 1234 5600 0007 85.",
      "fi-postal-code": "Five digits, for example 00100.",
      phone: "For example +358 40 123 4567."
    },
    fi: {
      email: "Esimerkiksi nimi@esimerkki.fi.",
      uri: "Alkaa https://, esimerkiksi https://esimerkki.fi.",
      url: "Alkaa https://, esimerkiksi https://esimerkki.fi.",
      date: "Esimerkiksi 2026-10-05.",
      time: "Esimerkiksi 14:30:00.",
      "fi-business-id": "Seitsemän numeroa, väliviiva ja tarkistusnumero, esimerkiksi 0737546-2.",
      "fi-personal-id": "Esimerkiksi 131052-308T.",
      iban: "Esimerkiksi FI21 1234 5600 0007 85.",
      "fi-postal-code": "Viisi numeroa, esimerkiksi 00100.",
      phone: "Esimerkiksi +358 40 123 4567."
    },
    es: {
      email: "Por ejemplo nombre@ejemplo.com.",
      uri: "Empieza por https://, por ejemplo https://ejemplo.com.",
      url: "Empieza por https://, por ejemplo https://ejemplo.com.",
      date: "Por ejemplo 2026-10-05.",
      time: "Por ejemplo 14:30:00.",
      "fi-business-id": "Siete dígitos, un guion y un dígito de control, por ejemplo 0737546-2.",
      "fi-personal-id": "Por ejemplo 131052-308T.",
      iban: "Por ejemplo FI21 1234 5600 0007 85.",
      "fi-postal-code": "Cinco dígitos, por ejemplo 00100.",
      phone: "Por ejemplo +57 300 123 4567."
    }
  };
  var FORMAT_MESSAGES = {
    en: {
      email: { shape: "This is not an email address." },
      uri: { shape: "This is not a web address. A web address starts with https://, for example." },
      url: { shape: "This is not a web address. A web address starts with https://, for example." },
      date: { shape: "This is not a date." },
      time: { shape: "This is not a time." },
      "date-time": { shape: "This is not a date and time." },
      "fi-business-id": {
        shape: "A Business ID has seven digits, a hyphen and a check digit.",
        check: "The check digit of the Business ID does not match. Check the digits."
      },
      "fi-personal-id": {
        shape: "A personal identity code has six digits, a century sign and four characters.",
        date: "The personal identity code does not start with a real date.",
        check: "The check character of the personal identity code does not match. Check the characters."
      },
      iban: {
        shape: "An IBAN starts with a country code and two digits, such as FI21.",
        length: "The IBAN has the wrong number of characters for its country.",
        check: "The check digits of the IBAN do not match. Check the account number."
      },
      "fi-postal-code": { shape: "A postal code has five digits." },
      phone: { shape: "This is not a phone number. Use digits, with a + at the start if needed." }
    },
    fi: {
      email: { shape: "Tämä ei ole sähköpostiosoite." },
      uri: { shape: "Tämä ei ole verkko-osoite. Osoite alkaa esimerkiksi https://." },
      url: { shape: "Tämä ei ole verkko-osoite. Osoite alkaa esimerkiksi https://." },
      date: { shape: "Tämä ei ole päivämäärä." },
      time: { shape: "Tämä ei ole kellonaika." },
      "date-time": { shape: "Tämä ei ole päivämäärä ja kellonaika." },
      "fi-business-id": {
        shape: "Y-tunnuksessa on seitsemän numeroa, väliviiva ja tarkistusnumero.",
        check: "Y-tunnuksen tarkistusnumero ei täsmää. Tarkista numerot."
      },
      "fi-personal-id": {
        shape: "Henkilötunnuksessa on kuusi numeroa, välimerkki ja neljä merkkiä.",
        date: "Henkilötunnuksen alussa ei ole oikeaa päivämäärää.",
        check: "Henkilötunnuksen tarkistusmerkki ei täsmää. Tarkista merkit."
      },
      iban: {
        shape: "IBAN alkaa maatunnuksella ja kahdella numerolla, esimerkiksi FI21.",
        length: "IBANissa on väärä määrä merkkejä tälle maalle.",
        check: "IBANin tarkistusnumerot eivät täsmää. Tarkista tilinumero."
      },
      "fi-postal-code": { shape: "Postinumerossa on viisi numeroa." },
      phone: { shape: "Tämä ei ole puhelinnumero. Käytä numeroita ja tarvittaessa alussa +-merkkiä." }
    },
    es: {
      email: { shape: "Esto no es una dirección de correo." },
      uri: { shape: "Esto no es una dirección web. Una dirección web empieza, por ejemplo, por https://." },
      url: { shape: "Esto no es una dirección web. Una dirección web empieza, por ejemplo, por https://." },
      date: { shape: "Esto no es una fecha." },
      time: { shape: "Esto no es una hora." },
      "date-time": { shape: "Esto no es una fecha con hora." },
      "fi-business-id": {
        shape: "El Y-tunnus tiene siete dígitos, un guion y un dígito de control.",
        check: "El dígito de control del Y-tunnus no coincide. Revisa los dígitos."
      },
      "fi-personal-id": {
        shape: "El número de identidad tiene seis dígitos, un signo de siglo y cuatro caracteres.",
        date: "El número de identidad no empieza con una fecha real.",
        check: "El carácter de control del número de identidad no coincide. Revisa los caracteres."
      },
      iban: {
        shape: "El IBAN empieza con el código del país y dos dígitos, por ejemplo FI21.",
        length: "El IBAN no tiene el número de caracteres que corresponde a su país.",
        check: "Los dígitos de control del IBAN no coinciden. Revisa el número de cuenta."
      },
      "fi-postal-code": { shape: "El código postal tiene cinco dígitos." },
      phone: { shape: "Esto no es un número de teléfono. Usa dígitos y, si hace falta, un + al principio." }
    }
  };

  // src/static/sdk-libs/validate/core.js
  var LANGS = ["en", "fi", "es"];
  var CUSTOM = {};
  for (const name of Object.keys(FORMAT_TESTS)) {
    format[name] = function(v) {
      return FORMAT_TESTS[name](v) === true;
    };
  }
  var WRAPPERS = /* @__PURE__ */ new Set([
    "properties",
    "patternProperties",
    "additionalProperties",
    "unevaluatedProperties",
    "allOf",
    "if",
    "$ref",
    "$recursiveRef",
    "items",
    "prefixItems",
    "additionalItems",
    "unevaluatedItems",
    "dependentSchemas",
    "propertyNames",
    "contains"
  ]);
  function lang(wanted) {
    let l = wanted;
    const ns = typeof window !== "undefined" ? (
      /** @type {any} */
      window.AIMEAT
    ) : null;
    if (!l && ns && ns.auth && typeof ns.auth.getLang === "function") l = ns.auth.getLang();
    if (!l && typeof document !== "undefined") l = document.documentElement.lang;
    if (!l && typeof navigator !== "undefined") l = navigator.language;
    const short = String(l || "en").slice(0, 2).toLowerCase();
    return LANGS.indexOf(short) >= 0 ? short : "en";
  }
  function inLang(text, l) {
    if (text == null) return "";
    if (typeof text !== "object") return String(text);
    const byLang = (
      /** @type {Record<string, unknown>} */
      text
    );
    if (typeof byLang[l] === "string") return (
      /** @type {string} */
      byLang[l]
    );
    if (typeof byLang.en === "string") return (
      /** @type {string} */
      byLang.en
    );
    for (const k of Object.keys(byLang)) if (typeof byLang[k] === "string") return (
      /** @type {string} */
      byLang[k]
    );
    return "";
  }
  function fill(s, vars) {
    return s.replace(/\{(\w+)\}/g, function(m, k) {
      return vars[k] != null ? String(vars[k]) : m;
    });
  }
  function list(items, l) {
    if (items.length < 2) return items.join("");
    return items.slice(0, -1).join(", ") + " " + LIST_WORD[
      /** @type {'en'} */
      l
    ] + " " + items[items.length - 1];
  }
  function dropEmpty(value) {
    if (Array.isArray(value)) return value.map(dropEmpty);
    if (!value || typeof value !== "object") return value;
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (v === "" || v === null || v === void 0) continue;
      out[k] = dropEmpty(v);
    }
    return out;
  }
  function segments(pointer) {
    return String(pointer || "#").replace(/^#\/?/, "").split("/").filter(Boolean).map(function(s) {
      return decodeURI(s).replace(/~1/g, "/").replace(/~0/g, "~");
    });
  }
  function propSchema(schema, path) {
    let s = schema;
    for (const seg of path) {
      if (!s || typeof s !== "object") return null;
      if (s.properties && s.properties[seg]) s = s.properties[seg];
      else if (s.items && typeof s.items === "object" && /^\d+$/.test(seg)) s = s.items;
      else return null;
    }
    return s;
  }
  function at(value, path) {
    let v = (
      /** @type {any} */
      value
    );
    for (const seg of path) {
      if (v == null) return void 0;
      v = v[seg];
    }
    return v;
  }
  function atPointer(schema, pointer) {
    let s = schema;
    for (const seg of segments(pointer)) {
      if (s == null || typeof s !== "object") return null;
      s = s[seg];
    }
    return s == null ? null : s;
  }
  function choiceFields(branches) {
    if (!Array.isArray(branches)) return [];
    const out = [];
    for (const b of branches) {
      if (!b || typeof b !== "object" || !Array.isArray(b.required)) return [];
      const extra = Object.keys(b).filter(function(k) {
        return k !== "required" && k !== "title" && k !== "description" && k.indexOf("x-") !== 0;
      });
      if (extra.length) return [];
      for (const r of b.required) if (out.indexOf(r) < 0) out.push(r);
    }
    return out;
  }
  function lastNumber(text) {
    const m = /(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)\D*$/i.exec(text);
    return m ? Number(m[1]) : null;
  }
  function quoted(text) {
    const out = [];
    const re = /"((?:[^"\\]|\\.)*)"/g;
    let m;
    while (m = re.exec(text)) out.push(m[1]);
    return out;
  }
  function compile(schema) {
    const root = (
      /** @type {any} */
      schema || {}
    );
    const validator = new Validator(
      /** @type {any} */
      root,
      "7",
      false
    );
    const order = Object.keys(root.properties || {});
    function place(field) {
      if (!field) return order.length + 1;
      const i = order.indexOf(field.split(".")[0]);
      return i < 0 ? order.length : i;
    }
    function label(field, opts, l) {
      if (opts.labels && opts.labels[field]) return opts.labels[field];
      const s = propSchema(root, field ? field.split(".") : []);
      return s && inLang(s.title, l) || field;
    }
    function hint2(field, wanted) {
      const l = lang(wanted);
      const s = propSchema(root, field ? field.split(".") : []);
      if (!s) return "";
      if (s["x-hint"]) return inLang(s["x-hint"], l);
      if (s.format && CUSTOM[s.format] && CUSTOM[s.format].hint) return inLang(CUSTOM[s.format].hint, l);
      if (s.format) return FORMAT_HINTS[l][s.format] || "";
      return "";
    }
    function words(field, rule, key, vars, l) {
      const s = propSchema(root, field ? field.split(".") : []);
      const own = s && s["x-messages"] && s["x-messages"][rule];
      return fill(own ? inLang(own, l) : MESSAGES[l][key], vars);
    }
    function check2(values, options) {
      const opts = options || {};
      const l = lang(opts.lang);
      const data = opts.keepEmpty ? values : dropEmpty(values);
      const raw = validator.validate(data).errors;
      const issues = [];
      const add = function(field, rule, message, params, fields2) {
        const issue = { field, rule, message, hint: hint2(field, l), params };
        if (fields2) issue.fields = fields2;
        issues.push(issue);
      };
      const nested = raw.filter(function(e) {
        return /\/(anyOf|oneOf|not)\/\d+/.test(e.keywordLocation);
      });
      for (const e of raw) {
        const kw = e.keyword;
        if (WRAPPERS.has(kw)) continue;
        if (nested.indexOf(e) >= 0) continue;
        const path = segments(e.instanceLocation);
        const here = path.join(".");
        const value = at(data, path);
        if (kw === "required" || kw === "dependencies" && /does not have/.test(e.error)) {
          const names = quoted(e.error);
          const field = (here ? here + "." : "") + names[names.length - 1];
          if (kw === "dependencies") {
            const other = label((here ? here + "." : "") + names[0], opts, l);
            add(field, "required", words(field, "required", "requiredBecause", { other }, l), { because: names[0] });
          } else {
            add(field, "required", words(field, "required", "required", {}, l), {});
          }
          continue;
        }
        if (kw === "dependencies") continue;
        if (kw === "format") {
          const name = quoted(e.error)[0] || "";
          const custom = CUSTOM[name];
          const reason = custom ? custom.test(value) : FORMAT_TESTS[name] ? FORMAT_TESTS[name](String(value)) : "shape";
          const reasonKey = typeof reason === "string" ? reason : "shape";
          const s = propSchema(root, path);
          const own = s && s["x-messages"] && s["x-messages"].format;
          let message;
          if (own) message = inLang(own, l);
          else if (custom && custom.message) message = inLang(custom.message, l);
          else {
            const table = FORMAT_MESSAGES[l][name];
            message = table ? table[reasonKey] || table.shape : MESSAGES[l].format;
          }
          add(here, "format", message, { format: name, reason: reasonKey });
          continue;
        }
        if (kw === "anyOf" || kw === "oneOf") {
          const names = choiceFields(atPointer(root, e.keywordLocation)).map(function(n) {
            return (here ? here + "." : "") + n;
          });
          const many = kw === "oneOf" && !/\(0 matches\)/.test(e.error);
          const key2 = !names.length ? "choice" : many ? "oneOf" : "anyOf";
          const labels = names.map(function(n) {
            return label(n, opts, l);
          });
          add(here, kw, words(here, kw, key2, { fields: list(labels, l) }, l), { fields: names }, names.length ? names : void 0);
          continue;
        }
        let key = kw;
        const params = {};
        if (kw === "minLength") {
          params.n = lastNumber(e.error);
          key = params.n === 1 ? "minLength1" : "minLength";
        } else if (kw === "maxLength") {
          params.n = lastNumber(e.error);
          params.len = typeof value === "string" ? Array.from(value).length : "";
        } else if (kw === "minimum" || kw === "maximum" || kw === "exclusiveMinimum" || kw === "exclusiveMaximum" || kw === "multipleOf") params.n = lastNumber(e.error);
        else if (kw === "minItems" || kw === "maxItems") params.n = lastNumber(e.error);
        else if (kw === "const") {
          const s = propSchema(root, path);
          const expected = s ? s.const : void 0;
          params.value = expected;
          if (expected === true) key = "constTrue";
        } else if (kw === "type") {
          const want = quoted(e.error).slice(1).join(" ");
          key = /\binteger\b/.test(want) ? "typeInteger" : /\bnumber\b/.test(want) ? "typeNumber" : "type";
          params.expected = want;
        } else if (kw === "false") key = "additional";
        else if (!MESSAGES[l][kw]) key = "choice";
        add(here, kw === "false" ? "additional" : kw, words(here, kw === "false" ? "additional" : kw, key, params, l), params);
      }
      sameAsIssues(
        root,
        /** @type {any} */
        data,
        [],
        function(field, other) {
          add(field, "sameAs", words(field, "sameAs", "sameAs", { other: label(other, opts, l) }, l), { other });
        }
      );
      issues.sort(function(a, b) {
        return place(a.field) - place(b.field);
      });
      const fields = {};
      const form = [];
      for (const i of issues) {
        if (!i.field) form.push(i);
        else if (!fields[i.field]) fields[i.field] = i;
      }
      return { valid: issues.length === 0, errors: issues, fields, form };
    }
    function missing(values, names, opts) {
      const r = check2(values, opts);
      const out = [];
      for (const i of r.errors) {
        const touched = [i.field].concat(i.fields || []);
        for (const f of touched) {
          if (names ? names.indexOf(f) >= 0 : true) {
            if (out.indexOf(f) < 0) out.push(f);
          }
        }
      }
      return out;
    }
    return {
      schema: root,
      check: check2,
      /**
       * One field's problem, the whole value checked so a rule between fields counts.
       * @param {string} name @param {unknown} values @param {CheckOptions} [opts]
       * @returns {Issue|null}
       */
      field: function(name, values, opts) {
        const r = check2(values, opts);
        if (r.fields[name]) return r.fields[name];
        return r.errors.find(function(i) {
          return (i.fields || []).indexOf(name) >= 0;
        }) || null;
      },
      /** Whether every named field (or the whole value) is filled in correctly. @param {unknown} values @param {string[]} [names] @param {CheckOptions} [opts] */
      ready: function(values, names, opts) {
        return missing(values, names, opts).length === 0;
      },
      missing,
      hint: hint2,
      /** @param {string} field @param {CheckOptions} [opts] */
      label: function(field, opts) {
        const o = opts || {};
        return label(field, o, lang(o.lang));
      }
    };
  }
  function sameAsIssues(schema, data, path, report) {
    if (!schema || typeof schema !== "object" || !schema.properties || !data || typeof data !== "object") return;
    for (const [name, s] of Object.entries(schema.properties)) {
      const sub = (
        /** @type {any} */
        s
      );
      if (!sub || typeof sub !== "object") continue;
      const other = sub["x-same-as"];
      if (typeof other === "string" && data[name] !== void 0 && data[name] !== data[other]) {
        report(path.concat(name).join("."), path.concat(other).join("."));
      }
      if (sub.properties) sameAsIssues(sub, data[name], path.concat(name), report);
    }
  }
  var cache = /* @__PURE__ */ new Map();
  function check(schema, values, opts) {
    const key = JSON.stringify(schema);
    let c = cache.get(key);
    if (!c) {
      c = compile(schema);
      if (cache.size >= 50) cache.delete(cache.keys().next().value);
      cache.set(key, c);
    }
    return c.check(values, opts);
  }
  function hint(schema, field, wanted) {
    return compile(schema).hint(field, wanted);
  }
  function addFormat(name, test, words) {
    const w = words || {};
    CUSTOM[name] = {
      test: function(v) {
        const r = test(String(v));
        return r === true ? true : typeof r === "string" ? r : "shape";
      },
      hint: w.hint,
      message: w.message
    };
    format[name] = function(v) {
      return CUSTOM[name].test(v) === true;
    };
  }
  function formats() {
    return Object.keys(format).sort();
  }

  // src/static/sdk-libs/validate/index.js
  attach("validate", {
    version: "1.0.0",
    compile,
    check,
    hint,
    addFormat,
    formats,
    lang,
    /** The AIMEAT format tests by name, each answering true or the reason a value fails. */
    formatTests: FORMAT_TESTS
  });
})();
