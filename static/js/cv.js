(function (global) {


    $.jmpress('register', 'cv', function () {

        // on each step hide/show nav
        var setActive = function (step) {
            if ($(step).attr('id') === 'overview') {
                $('.nav').fadeOut();
                $('.hint').stop(true, true).delay(3000).fadeIn();
            } else {
                $('.nav').fadeIn();
                $('.hint').stop(true, true).fadeOut();
            }
        };


        var config = {
            stepSelector: 'section',
            viewPort: {
                width: 1300,
                maxScale: 1
            },
            presentationMode: {
                notesUrl: 'index.notes.html'
            },
            setActive: setActive
        };


        // START JMPRESS and enable esc key de-init toggle
        $(this).jmpress('toggle', 27, config, true);

    });


    $('.jmpress').jmpress('cv');


}(window));