(function () {
    var btn = document.getElementById("menu-btn");
    var drawer = document.getElementById("menu-drawer");
    var backdrop = document.getElementById("menu-backdrop");
    var closeBtn = document.getElementById("menu-close");
    if (!btn || !drawer) return;

    function closeMenu() {
        drawer.setAttribute("hidden", "");
        if (backdrop) backdrop.setAttribute("hidden", "");
        document.body.classList.remove("menu-open");
        btn.setAttribute("aria-expanded", "false");
    }

    function openMenu() {
        drawer.removeAttribute("hidden");
        if (backdrop) backdrop.removeAttribute("hidden");
        document.body.classList.add("menu-open");
        btn.setAttribute("aria-expanded", "true");
    }

    btn.addEventListener("click", function () {
        if (drawer.hasAttribute("hidden")) openMenu();
        else closeMenu();
    });
    if (closeBtn) closeBtn.addEventListener("click", closeMenu);
    if (backdrop) backdrop.addEventListener("click", closeMenu);
    document.addEventListener("keydown", function (e) {
        if (e.key === "Escape") closeMenu();
    });
})();
