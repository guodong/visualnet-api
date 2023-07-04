var express = require("express");
var router = express.Router();
const axios = require("axios");

var sites = require("../res/cache/sites.json");
axios.defaults.withCredentials = true;

async function getCookies() {
  let q = {
    providerType: "anonymous",
    providerName: "anonymous1",
    currentURL: "/",
  };
  let url = "https://atlas-kibana.mwt2.org:5601/internal/security/login";
  let headers = { "kbn-xsrf": true };
  let r = await axios.post(url, q, { headers: headers });
  return r.headers["set-cookie"];
}

let metric_to_index = {
  tput: "ps_throughput",
  "delay-ow": "ps_owd",
};
let metric_to_key = {
  tput: "throughput",
  "delay-ow": "delay_mean",
};

router.post("/lookup", async function (req, res, next) {
  let useCache = Object.keys(req.query).includes("cache");
  let { srcs, dsts } = req.body.endpoints;
  let metric = req.body["cost-type"]["cost-metric"];

  let resp = {
    meta: {
      "cost-type": req.body["cost-type"],
    },
    "endpoint-cost-map": {},
  };

  function getSiteByHost(host) {
    let hn = host.split(":")[1];
    for (let site of Object.values(sites)) {
      for (let srv of Object.values(site.services)) {
        if (srv.name == hn) {
          return site.name;
        }
      }
    }

    return null;
  }

  let src_sites = srcs
    .map((s) => getSiteByHost(s))
    .filter((site) => site != null);
  src_sites = [...new Set(src_sites)];

  let dst_sites = dsts
    .map((s) => getSiteByHost(s))
    .filter((site) => site != null);
  dst_sites = [...new Set(dst_sites)];

  let q = {
    size: 0,
    sort: [
      {
        timestamp: {
          order: "desc",
        },
      },
    ],
    query: {
      bool: {
        filter: [
          {
            terms: {
              src_site: src_sites,
            },
          },
          {
            terms: {
              dest_site: dst_sites,
            },
          },
        ],
        must: [{ term: { ipv6: false } }],
      },
    },
    aggs: {
      pipe: {
        multi_terms: {
          terms: [
            {
              field: "src_site",
            },
            {
              field: "dest_site",
            },
          ],
          size: 10000,
        },
        aggs: {
          latest: {
            top_hits: {
              sort: [
                {
                  timestamp: {
                    order: "desc",
                  },
                },
              ],
              size: 1,
            },
          },
        },
      },
    },
  };

  console.log(JSON.stringify(q));

  getCookies().then(async (cookie) => {
    let url = `https://atlas-kibana.mwt2.org:5601/s/networking/api/console/proxy?path=${metric_to_index[metric]}%2F_search&method=GET`;
    let headers = { "kbn-xsrf": true, Cookie: cookie };

    const r = await axios.post(url, q, { headers: headers });
    let data = {};
    r.data.aggregations.pipe.buckets.forEach((b) => {
      let key = b.key_as_string;
      // there must be one hits, otherwise the aggs key does not exists
      let val = b.latest.hits.hits[0]._source;
      data[key] = val;
    });

    let ret = {};
    for (let src of srcs) {
      let src_site = getSiteByHost(src);
      if (src_site == null) {
        continue;
      }
      for (let dst of dsts) {
        let dst_site = getSiteByHost(dst);
        if (dst_site == null) {
          continue;
        }
        let key = `${src_site}|${dst_site}`;
        if (Object.keys(data).includes(key)) {
          if (!Object.keys(ret).includes(src)) {
            ret[src] = {};
          }
          ret[src][dst] = data[key][metric_to_key[metric]];
        }
      }
    }
    resp["endpoint-cost-map"] = ret;
    res.json(resp);
  });
});

router.post("/cache", async function (req, res, next) {
  const tracesCache = require("../res/traces_cache.json");
  res.json(tracesCache);
});

module.exports = router;
