# SIEM and Wazuh

This page is for the operator and the SOC that watch an AIMEAT node. It says how to send the node's security events to your SIEM, what one event looks like, and how to read them in Wazuh with a decoder and a few rules.

The exporter is `aimeat/src/services/node-admin/siem-export.ts`. What it sends and the settings are also listed on [10 Logging and monitoring](../it-adoption/10-logging-monitoring.md#export-to-a-siem).

## Turn it on

Set one or both targets, on the admin Config page (Security) or in the environment. Both take effect without a restart.

| Setting | Value | Example |
|---|---|---|
| `AIMEAT_SIEM_SYSLOG` (`security.siem_syslog`) | `udp://host:port` or `tcp://host:port` | `udp://10.0.0.5:514` |
| `AIMEAT_SIEM_OTLP_URL` (`security.siem_otlp_url`) | an OTLP/HTTP logs endpoint | `https://collector.example:4318/v1/logs` |
| `AIMEAT_SIEM_EVENTS` (`security.siem_events`) | the kinds, comma-separated; empty is every kind but `trail` | `refusal,operator,incident,team` |

Open the firewall from the node to the collector: UDP or TCP to the syslog port, HTTPS to the OTLP endpoint. The OTLP endpoint may be on your own network: the address you set is the one exception the node's outbound guard allows for it.

## What one event looks like

Syslog, RFC 5424. The message is one JSON object with the whole event:

```
<108>1 2026-11-15T10:04:11.201Z node-1 aimeat - refusal - {"kind":"refusal","node":"aimeat-node-1","at":"2026-11-15T10:04:11.201Z","status":401,"code":"AUTH_REQUIRED","reason":"bad token","method":"GET","path":"/v1/memory","ip":"198.51.100.7","host":"node.example","ua":"curl/8","credential":"bearer-jwt","credential_digest":"3f9a1c2b"}
```

| Kind | Priority | Fields |
|---|---|---|
| `refusal` | `<108>` (log audit, warning) | `status`, `code`, `reason`, `method`, `path`, `ip`, `host`, `ua`, `credential`, `credential_digest`, `principal` when the credential parsed |
| `incident` | `<108>` | `id`, `type`, `code`, `actor`, `source`, `quarantined` |
| `operator` | `<109>` (log audit, notice) | `operator`, `actor`, `act` (such as `config.set`, `memory.read`), `account` when it was in a person's account, `key` or `subject` |
| `team` | `<109>` | `approval_id`, `organism_id`, `action` (`team:delete`, `team:send`, `team:pay`), `actor`, `status` (`pending`, `approved`, `rejected`), `decided_by`, `summary` |
| `trail` | `<134>` (local0, info) | `account`, `actor`, `actor_kind`, `surface`, `call`, `outcome`, `reason`, `counterparty`, `duration_ms` |

Over OTLP the same event is one log record: `severityText` WARN for a refusal, ERROR for an incident, INFO for the rest, the JSON as the body, and each field as an attribute `aimeat.<field>`. The resource has `service.name=aimeat` and `aimeat.node`.

TCP lines are newline-framed. Events that arrive while the TCP connection is being opened are dropped; the first event after a collector comes back opens it again.

## Wazuh

Point the node at the Wazuh manager's syslog port (`AIMEAT_SIEM_SYSLOG=udp://wazuh-manager:514`) and let the manager listen for the node's address in `ossec.conf`:

```xml
<remote>
  <connection>syslog</connection>
  <port>514</port>
  <protocol>udp</protocol>
  <allowed-ips>10.0.0.20/32</allowed-ips>
</remote>
```

Decoder, in `/var/ossec/etc/decoders/aimeat_decoders.xml`. It finds the program name `aimeat` and hands the JSON to Wazuh's JSON decoder:

```xml
<decoder name="aimeat">
  <program_name>^aimeat$</program_name>
</decoder>

<decoder name="aimeat-json">
  <parent>aimeat</parent>
  <prematch>^- \w+ - {</prematch>
  <plugin_decoder offset="after_prematch">JSON_Decoder</plugin_decoder>
</decoder>
```

If your Wazuh version does not split the RFC 5424 header, use the prematch `aimeat - \w+ - {` on the full line instead.

Rules, in `/var/ossec/etc/rules/aimeat_rules.xml`. The ids are in the local range; change them to fit yours:

```xml
<group name="aimeat,">
  <rule id="100400" level="3">
    <decoded_as>aimeat</decoded_as>
    <description>AIMEAT: $(kind) event</description>
  </rule>

  <rule id="100401" level="5">
    <if_sid>100400</if_sid>
    <field name="kind">^refusal$</field>
    <description>AIMEAT: request refused ($(code)) on $(path) from $(ip)</description>
    <group>authentication_failed,</group>
  </rule>

  <rule id="100402" level="10" frequency="10" timeframe="300">
    <if_matched_sid>100401</if_matched_sid>
    <same_field>ip</same_field>
    <description>AIMEAT: many refusals from one address ($(ip))</description>
    <group>authentication_failures,</group>
  </rule>

  <rule id="100403" level="12">
    <if_sid>100400</if_sid>
    <field name="kind">^incident$</field>
    <description>AIMEAT: security incident $(type) ($(code)) by $(actor)</description>
  </rule>

  <rule id="100404" level="8">
    <if_sid>100400</if_sid>
    <field name="kind">^operator$</field>
    <field name="account">\S</field>
    <description>AIMEAT: operator $(operator) did $(act) in the account $(account)</description>
  </rule>

  <rule id="100405" level="6">
    <if_sid>100400</if_sid>
    <field name="kind">^team$</field>
    <description>AIMEAT: team approval $(action) $(status)</description>
  </rule>
</group>
```

Restart the manager (`systemctl restart wazuh-manager`) and test a line with `/var/ossec/bin/wazuh-logtest`.

## What to alert on

The alert list on [10 Logging and monitoring](../it-adoption/10-logging-monitoring.md#what-to-alert-on) applies. With the events in the SIEM, three of its rows no longer need a poll: credential guessing (rule 100402), operator access to a person's data (100404), and a security incident opened (100403).

## What it does not send

- Record content, file content, a message body, a setting's value, a credential. The `trail` names the call, not its arguments.
- The process log. Collect it with journald forwarding or the container log driver, as before.
- Events from before the target was set: nothing is buffered across a restart, and a collector that is down loses what arrives meanwhile. The refusal log file (`AIMEAT_AUTH_LOG_PATH`) still keeps refusals on the node's own disk.
