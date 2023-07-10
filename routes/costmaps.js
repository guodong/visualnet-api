var express = require("express");
var router = express.Router();
const axios = require("axios");
const dayjs = require("dayjs");
const fs = require("fs");
const math = require("mathjs");

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

/**
 *
 * @param {*} pid
 * @returns if no site holding pid, returns null; otherwise returns the list of PS instance names
 *
 */
function pidToPSes(pid) {
  const [type, name] = [
    pid.slice(0, pid.indexOf(":")),
    pid.slice(pid.indexOf(":") + 1),
  ];

  if (type == "host") {
    for (let site of Object.values(sites)) {
      for (let srv of Object.values(site.services)) {
        if (srv.name == name) {
          // if the pid is an instance of PS, just return it
          if (srv.type == "PS") {
            return [srv.name];
          }
          return pidToPSes(`site:${site.name}`);
        }
      }
    }

    return null;
  }

  if (type == "site") {
    let site = sites[name];
    if (site == undefined) {
      return null;
    }
    return Object.values(site.services)
      .filter((srv) => srv.type == "PS")
      .map((srv) => srv.name);
  }
}

router.post("/", async function (req, res, next) {
  let useCache = Object.keys(req.query).includes("cache");
  let { interval } = req.body;
  let [metric, anchor, agg] = [
    req.body["cost-type"]["cost-metric"],
    req.body["cost-type"]["anchor-alg"],
    req.body["cost-type"]["aggregate"],
  ];
  let { srcs, dsts } = req.body.endpoints;
  // let metric = req.body["cost-type"]["cost-metric"];

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

  let src_pid_to_PSes = {};
  srcs.forEach((s) => {
    src_pid_to_PSes[s] = pidToPSes(s);
  });

  let dst_pid_to_PSes = {};
  dsts.forEach((s) => {
    dst_pid_to_PSes[s] = pidToPSes(s);
  });

  let q = {
    size: 10000,
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
              src_host: Object.values(src_pid_to_PSes).flatMap((e) => e),
            },
          },
          {
            terms: {
              dest_host: Object.values(dst_pid_to_PSes).flatMap((e) => e),
            },
          },
        ],
        // must: [{ term: { ipv6: false } }],
      },
    },
    // aggs: {
    //   pipe: {
    //     multi_terms: {
    //       terms: [
    //         {
    //           field: "src_site",
    //         },
    //         {
    //           field: "dest_site",
    //         },
    //       ],
    //       size: 10000,
    //     },
    //     aggs: {
    //       latest: {
    //         top_hits: {
    //           sort: [
    //             {
    //               timestamp: {
    //                 order: "desc",
    //               },
    //             },
    //           ],
    //           size: 1,
    //         },
    //       },
    //     },
    //   },
    // },
  };

  if (interval) {
    if (interval.last) {
      let re = new RegExp("([0-9]*)([a-z]*)");
      let [_, num, unit] = re.exec(interval.last);
      let now = dayjs();
      let from = now.subtract(num, unit);

      q.query.bool.filter.push({
        range: {
          timestamp: {
            format: "strict_date_optional_time",
            gte: from,
            lte: now,
          },
        },
      });
    }
  }

  console.log(JSON.stringify(q, undefined, 2));

  getCookies().then(async (cookie) => {
    let url = `https://atlas-kibana.mwt2.org:5601/s/networking/api/console/proxy?path=${metric_to_index[metric]}%2F_search&method=GET`;
    let headers = { "kbn-xsrf": true, Cookie: cookie };

    const r = await axios.post(url, q, { headers: headers });

    if (1) {
      fs.writeFileSync("resp.json", JSON.stringify(r.data, null, 2));
    }

    // let data = {};
    // r.data.aggregations.pipe.buckets.forEach((b) => {
    //   let key = b.key_as_string;
    //   // there must be one hits, otherwise the aggs key does not exists
    //   let val = b.latest.hits.hits[0]._source;
    //   data[key] = val;
    // });

    let raw = {};
    for (let src of srcs) {
      if (!raw.hasOwnProperty(src)) {
        raw[src] = {};
      }
      for (let dst of dsts) {
        if (!raw.hasOwnProperty(dst)) {
          raw[src][dst] = [];
        }
        r.data.hits.hits
          .filter(
            (hit) =>
              src_pid_to_PSes[src].includes(hit._source.src_host) &&
              dst_pid_to_PSes[dst].includes(hit._source.dest_host)
          )
          .forEach((hit) => {
            let source = hit._source;
            raw[src][dst].push(source);
          });
      }
    }
    let ret = {};
    if (agg != undefined) {
      Object.entries(raw).forEach(([src, data]) => {
        if (!ret.hasOwnProperty(src)) {
          ret[src] = {};
        }
        Object.entries(data).forEach(([dst, mdata]) => {
          let aggdata = null;
          if (mdata.length != 0) {
          if (agg == "avg") {
            aggdata = math.mean(mdata.map((d) => d[metric_to_key[metric]]));
          } else if (agg == "max") {
            aggdata = math.max(mdata.map((d) => d[metric_to_key[metric]]));
          } else if (agg == "min") {
            aggdata = math.min(mdata.map((d) => d[metric_to_key[metric]]));
          } else if (agg == "med") {
            aggdata = math.median(mdata.map((d) => d[metric_to_key[metric]]));
          } else {
            res.json({ err: `Unknown agg: ${agg}` });
            return;
          }
        }
          ret[src][dst] = aggdata;
        });
      });
      resp["endpoint-cost-map"] = ret;
    } else {
      resp["endpoint-cost-map"] = raw;
    }

    res.json(resp);
  });
});

router.post("/cache", async function (req, res, next) {
  const tracesCache = require("../res/traces_cache.json");
  res.json(tracesCache);
});

module.exports = router;
