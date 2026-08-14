(function () {
    var root = document.querySelector(".rp");
    if (!root) return;

    var cal = root.querySelector(".rp-cal");
    var onlineHex = "#e65100";
    var offlineHex = "#ffffff";

    function applyVars() {
        if (!cal) return;
        cal.style.setProperty("--sel-ring-online", onlineHex);
        cal.style.setProperty("--sel-ring-offline", offlineHex);
    }

    function setActive(group, hex) {
        var buttons = group.querySelectorAll(".rp-swatch-btn");
        for (var i = 0; i < buttons.length; i++) {
            buttons[i].classList.toggle("is-on", buttons[i].getAttribute("data-hex") === hex);
        }
    }

    var groups = root.querySelectorAll("[data-picker]");
    for (var g = 0; g < groups.length; g++) {
        (function (group) {
            group.addEventListener("click", function (e) {
                var btn = e.target.closest(".rp-swatch-btn");
                if (!btn || !group.contains(btn)) return;
                var hex = btn.getAttribute("data-hex");
                if (!hex) return;
                var kind = group.getAttribute("data-picker");
                if (kind === "online") onlineHex = hex;
                else if (kind === "offline") offlineHex = hex;
                applyVars();
                setActive(group, hex);
            });
        })(groups[g]);
    }

    if (cal) {
        cal.addEventListener("click", function (e) {
            var td = e.target.closest("td[data-iso]");
            if (!td || !cal.contains(td)) return;
            td.classList.toggle("sel");
        });
    }

    applyVars();
})();
