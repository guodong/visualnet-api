var express = require("express");
var router = express.Router();
var siteList = require("../res/site_list.json");
var rcsiteList = require("../res/rcsite_list.json");
var serviceList = require("../res/service_list.json");

router.get("/", async function (req, res, next) {
  let sites = {};
  function getServices(siteName) {
    let services = {};
    if (siteName in rcsiteList) {
      rcsiteList[siteName].services.forEach((srv) => {
        if (srv.type == "SE") {
          Object.values(serviceList[srv.name].protocols).forEach((protocal) => {
            let name = protocal.endpoint.split("//")[1].split(":")[0];
            services[name] = {
              name: name,
              type: "SE",
            };
          });
        }
        if (srv.type == "PerfSonar") {
          services[srv.endpoint] = {
            name: srv.endpoint,
            type: "PS",
          };
        }
      });
    }
    return services;
  }
  Object.values(siteList).forEach((entry) => {
    sites[entry.name] = {
      name: entry.name,
      latitude: entry.latitude,
      longitude: entry.longitude,
      networks: entry.networks,
      country: entry.country,
      tier: entry.tier_level,
      vo: entry.vo_name,
    };
    let services = getServices(entry.name);

    sites[entry.name].services = services;
  });
  res.json(sites);
});

module.exports = router;
