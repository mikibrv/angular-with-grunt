module.exports = function (grunt) {
    grunt.config('less', {
        less: {
            options: {
                paths: ["src/static/css"],
                concat: true
            },
            files: [
                {
                    expand: true,
                    cwd: 'src/static/css/',
                    src: ['*.less'],
                    dest: '.tmp/static/css/',
                    ext: '.css'
                }
            ]
        }
    });
};