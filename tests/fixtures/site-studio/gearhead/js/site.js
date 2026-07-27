// GearHead Garage front-end widgets
var BUSINESS_NAME = "GearHead Garage";
var BUSINESS_PHONE = "(720) 555-0113";

document.addEventListener("DOMContentLoaded", function () {
  var banner = document.getElementById("cta-banner");
  if (banner) {
    banner.textContent = BUSINESS_NAME + " — call " + BUSINESS_PHONE + " today";
  }
});
