// Builds a Grafana Explore deep-link into the Loki logs for a PR's preview
// environment. Each PR is deployed into a `dev-<number>` Kubernetes namespace,
// so the link pre-fills a LogQL selector for that namespace over the last hour.
//
// The Grafana Explore base URL (e.g. `https://grafana.example.com/explore`)
// comes from `GHDASH_LOKI_URL`; returns null when it isn't configured.

export function lokiLogsUrl(prNumber: number): string | null {
  const base = process.env.GHDASH_LOKI_URL;
  if (!base) return null;

  // Mirrors the pane shape Grafana Explore encodes into the URL; `mia` is the
  // (arbitrary) pane id Grafana assigns to a single Explore pane.
  const panes = {
    mia: {
      datasource: "Loki",
      queries: [
        {
          refId: "A",
          expr: `{namespace="dev-${prNumber}"}`,
          queryType: "range",
          datasource: { type: "loki", uid: "Loki" },
          editorMode: "builder",
          direction: "backward",
        },
      ],
      range: { from: "now-1h", to: "now" },
    },
  };

  const params = new URLSearchParams({
    schemaVersion: "1",
    panes: JSON.stringify(panes),
    orgId: "1",
  });

  return `${base}?${params.toString()}`;
}
