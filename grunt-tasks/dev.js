/**
 * Created by mcsere on 1/9/15.
 */
module.exports = function (grunt) {

    grunt.config('setenv', {
        options: {
            envFolder: "grunt-tasks/env"
        },
        dev: {

        },
        prod:{

        }
    });

    grunt.registerTask('build', function (env) {
        grunt.task.run([
            'setenv:dev',
            "clean",
            'less',
            'copy'
        ]);
    });

    grunt.registerTask('dev', function (env) {
        grunt.task.run([
            'setenv:dev',
            'watch'
        ]);
    });


    grunt.registerTask('serve', function (env) {
        grunt.task.run([
            'setenv:dev',
            'build',
            'connect',
            'watch'
        ]);
    });

    grunt.config("watch", {
        less: {
            files: ['src/static/**/*.less'],
            tasks: ['newer:less', 'copy:css'],
            options: {
                livereload: true
            }
        },
        app: {
            files: ['src/app/**/*.js'],
            tasks: ['newer:copy:app'],
            options: {
                livereload: true
            }
        },
        vendor: {
            files: [ 'src/static/vendor', 'src/static/js', 'src/static/img', 'src/index.html'],
            tasks: ['newer:copy'],
            options: {
                livereload: true
            }
        }
    });


    grunt.config("connect", {
        connect: {
            options: {
                port: 8443,
                useAvailablePort: true,
                // Change this to '0.0.0.0' to access the server from outside.
                hostname: 'localhost',
                livereload: 35729,
                base: '<%=env.root%>'
            }
        }
    });


};