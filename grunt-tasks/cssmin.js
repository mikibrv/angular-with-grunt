/**
 * Created by mcsere on 1/9/15.
 */

module.exports = function (grunt) {
    grunt.config('cssmin', {
            cssmin: {
                    files: [
                        {
                            expand: true,
                            cwd: '.tmp/concat/static/css/',
                            src: ['bundle.css', '!*.min.css'],
                            dest: '<%=env.root%>/static/css',
                            ext: '.min.css'
                        }
                    ]
            }
        }

    );
};