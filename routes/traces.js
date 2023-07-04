var express = require("express");
var router = express.Router();
const axios = require("axios");
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

router.post("/", async function (req, res, next) {
  let { srcs, dsts } = req.body;

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
              src_site: srcs,
            },
          },
          {
            terms: {
              dest_site: dsts,
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
          size: 10000
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

  getCookies().then(async (cookie) => {
    let url =
      "https://atlas-kibana.mwt2.org:5601/s/networking/api/console/proxy?path=ps_trace%2F_search&method=GET";
    let headers = { "kbn-xsrf": true, Cookie: cookie };

    const r = await axios.post(url, q, { headers: headers });
    let data = {}
    r.data.aggregations.pipe.buckets.forEach(b => {
      let key = b.key_as_string
      let val = b.latest.hits.hits[0]._source
      data[key] = val
    })
    res.json(data);
  });
});


router.post("/cache", async function (req, res, next) {
  const tracesCache = require('../res/traces_cache.json')
  res.json(tracesCache)
})

module.exports = router;
