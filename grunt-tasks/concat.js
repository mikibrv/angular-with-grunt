/**
 * Created by mcsere on 1/9/15.
 */

module.exports = function (grunt) {
    grunt.config('concat', {
        generated: {
            files: [
                {
                    src: '.tmp/concat/static/css/vendor.min.css',
                    dest: '<%=env.root%>/static/css/vendor.min.css'
                }
            ]
        },
        css: {
            files: [
                {
                    src: ['.tmp/static/css/*.css'],
                    dest: '.tmp/static/css/bundle.css'
                }
            ]
        },
        require: {
            files: [
                {
                    src: ['src/static/vendor/requirejs/require.js', '<%=env.root%>/app/app.js'],
                    dest: '<%=env.root%>/app/app.js'
                }
            ]
        }
    });
};