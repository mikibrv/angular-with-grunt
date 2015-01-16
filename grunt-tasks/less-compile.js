module.exports = function (grunt) {
    grunt.config('less', {
            less: {
                options: {
                    paths: ["src/static/less/**/"]
                },
                files: [
                    {
                        expand: true,
                        cwd: 'src/static/less/',
                        src: ['**/*.less'],
                        dest: '.tmp/static/css/',
                        ext: '.css'
                    }
                ]
            },
            dev: {
                options: {
                    paths: ["src/static/less/**/"]
                },
                files: [
                    {
                        expand: true,
                        cwd: 'src/static/less/',
                        src: ['**/*.less'],
                        dest: 'src/static/css/',
                        ext: '.css'
                    }
                ]

            }
        }
    );
};