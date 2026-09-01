function openSidebar(title,content){

    document
    .getElementById("sidebar")
    .classList
    .remove("hidden");

    document
    .getElementById("regionTitle")
    .innerHTML = title;

    document
    .getElementById("regionContent")
    .innerHTML = content;

    appState.sidebarOpen = true;

}


function closeSidebar(){

    document
    .getElementById("sidebar")
    .classList
    .add("hidden");

    appState.sidebarOpen = false;

}